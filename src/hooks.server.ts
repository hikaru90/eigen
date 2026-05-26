import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { appSql, appDbAsyncLocal, createScopedDrizzle } from '$lib/server/db';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { hashApiKey } from '$lib/server/api-keys/api-key-utils';
import { userApiKey } from '$lib/server/db/brain.schema';
import { eq, and } from 'drizzle-orm';

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
			const reserved = await appSql.reserve();
			try {
				const rows = await createScopedDrizzle(reserved)
					.select({ userId: userApiKey.userId, id: userApiKey.id })
					.from(userApiKey)
					.where(and(eq(userApiKey.keyHash, hash), eq(userApiKey.isActive, true)))
					.limit(1);
				if (rows.length > 0) {
					const row = rows[0];
					createScopedDrizzle(reserved)
						.update(userApiKey)
						.set({ lastUsedAt: new Date() })
						.where(eq(userApiKey.id, row.id))
						.catch(() => {/* non-critical */});
					event.locals.user = {
						id: row.userId,
						email: '',
						name: '',
						emailVerified: false,
						createdAt: new Date(),
						updatedAt: new Date(),
						image: null
					} as typeof event.locals.user;
				}
			} finally {
				await reserved.release();
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
			await reserved`select set_config('app.current_user_id', ${uid}, false)`;
			const scopedDb = createScopedDrizzle(reserved);
			return await appDbAsyncLocal.run(scopedDb, () => resolve(opts));
		} finally {
			await reserved`select set_config('app.current_user_id', '', false)`;
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

export const handle: Handle = sequence(handleParaglide, handleWellKnown, handleBetterAuth, handleCrossOriginOpenerPolicy);
