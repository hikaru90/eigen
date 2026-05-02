import { sequence } from '@sveltejs/kit/hooks';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit';
import { appSql, appDbAsyncLocal, createScopedDrizzle } from '$lib/server/db';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';

const handleParaglide: Handle = ({ event, resolve }) => paraglideMiddleware(event.request, ({ request, locale }) => {
	event.request = request;

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale).replace('%paraglide.dir%', getTextDirection(locale))
	});
});

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
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

const handleCrossOriginIsolation: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	return response;
};

export const handle: Handle = sequence(handleParaglide, handleBetterAuth, handleCrossOriginIsolation);
