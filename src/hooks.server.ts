import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { tenantUserAsyncLocal } from '$lib/server/billing/context';
import { appSql, appDbAsyncLocal, createScopedDrizzle, activateTenantDbSession, deactivateTenantDbSession } from '$lib/server/db';
import { authSql } from '$lib/server/db/auth-db';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { hashApiKey } from '$lib/server/api-keys/api-key-utils';
import { startJobQueueTicker } from '$lib/server/job-queue/ticker';
import { logOpsStartupDiagnostics } from '$lib/server/ops/startup-diagnostics';
import { captureServerException } from '$lib/server/analytics/posthog-server';

if (!building) {
	logOpsStartupDiagnostics();
	startJobQueueTicker();
}

const handleParaglide: Handle = ({ event, resolve }) => paraglideMiddleware(event.request, ({ request, locale }) => {
	event.request = request;

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale).replace('%paraglide.dir%', getTextDirection(locale))
	});
});

/**
 * Serve OAuth 2.0 discovery documents required by MCP clients.
 * We don't run a real OAuth server — we advertise Bearer-token-only auth
 * so clients that already have an API key skip the OAuth dance entirely.
 */
const handleWellKnown: Handle = async ({ event, resolve }) => {
	const { pathname } = new URL(event.request.url);
	const origin = new URL(event.request.url).origin;

	// Both path-specific (/api/mcp) and root variants are handled
	if (
		pathname === '/.well-known/oauth-protected-resource' ||
		pathname === '/.well-known/oauth-protected-resource/api/mcp'
	) {
		return new Response(
			JSON.stringify({
				resource: `${origin}/api/mcp`,
				authorization_servers: [origin],
				bearer_methods_supported: ['header'],
				resource_name: 'Eigen Memory MCP'
			}),
			{ headers: { 'content-type': 'application/json' } }
		);
	}

	if (pathname === '/.well-known/oauth-authorization-server') {
		return new Response(
			JSON.stringify({
				issuer: origin,
				authorization_endpoint: `${origin}/login`,
				token_endpoint: `${origin}/api/auth/token`,
				response_types_supported: ['token'],
				grant_types_supported: ['urn:ietf:params:oauth:grant-type:api-key'],
				token_endpoint_auth_methods_supported: ['none']
			}),
			{ headers: { 'content-type': 'application/json' } }
		);
	}

	return resolve(event);
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	// API key auth: resolve Bearer token for routes that need it (e.g. /api/mcp)
	if (!event.locals.user) {
		const authHeader = event.request.headers.get('authorization') ?? '';
		const match = authHeader.match(/^Bearer\s+(eigen_[0-9a-f]+)$/i);
		if (match) {
			const hash = hashApiKey(match[1]);
			const rows = await authSql<Array<{ id: string; user_id: string; key_name: string }>>`
				SELECT id, user_id, key_name FROM public.resolve_user_api_key(${hash})
			`;
			if (rows.length > 0) {
				const row = rows[0];
				authSql`SELECT touch_user_api_key(${row.id}::uuid)`.catch(() => {/* non-critical */});
				event.locals.apiKeyAuth = { id: row.id, name: row.key_name };
				event.locals.user = {
					id: row.user_id,
					email: '',
					name: '',
					emailVerified: false,
					createdAt: new Date(),
					updatedAt: new Date(),
					image: null
				} as typeof event.locals.user;
			}
		}
	}

	const resolveWithAppDb: typeof resolve = async (opts) => {
		if (building) {
			return resolve(opts);
		}

		const reserved = await appSql.reserve();
		try {
			const uid = event.locals.user?.id ?? '';
			await activateTenantDbSession(reserved, uid);
			const scopedDb = createScopedDrizzle(reserved);
			const run = () => appDbAsyncLocal.run(scopedDb, () => resolve(opts));
			return uid ? await tenantUserAsyncLocal.run(uid, run) : await run();
		} finally {
			await deactivateTenantDbSession(reserved).catch(() => {});
			await reserved.release();
		}
	};

	return svelteKitHandler({ event, resolve: resolveWithAppDb, auth, building });
};

/** COOP only — do not set COEP `require-corp` globally; it blocks third-party scripts (e.g. PayPal SDK). */
const handleCrossOriginOpenerPolicy: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
	return response;
};

const handlePostHogProxy: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith('/ingest')) {
		const useAssetHost = pathname.startsWith('/ingest/static/') || pathname.startsWith('/ingest/array/');
		const hostname = useAssetHost ? 'eu-assets.i.posthog.com' : 'eu.i.posthog.com';

		const url = new URL(event.request.url);
		url.protocol = 'https:';
		url.hostname = hostname;
		url.port = '443';
		url.pathname = pathname.replace(/^\/ingest/, '');

		const headers = new Headers(event.request.headers);
		headers.set('host', hostname);
		headers.set('accept-encoding', '');

		const clientIp = event.request.headers.get('x-forwarded-for') || event.getClientAddress();
		if (clientIp) {
			headers.set('x-forwarded-for', clientIp);
		}

		const response = await fetch(url.toString(), {
			method: event.request.method,
			headers,
			body: event.request.body,
			// @ts-expect-error - duplex is required for streaming request bodies
			duplex: 'half'
		});

		return response;
	}

	return resolve(event);
};

export const handle: Handle = sequence(handlePostHogProxy, handleParaglide, handleWellKnown, handleBetterAuth, handleCrossOriginOpenerPolicy);

export const handleError: HandleServerError = ({ error, status, event }) => {
	if (status !== 404) {
		captureServerException(error, event.locals.user?.id, {
			status,
			path: event.url.pathname,
			route_id: event.route?.id ?? null
		});
	}
};
