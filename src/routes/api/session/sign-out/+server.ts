import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';

/** Outside `/api/auth` so `svelteKitHandler` does not intercept; uses Better Auth server API + request cookies. */
export const POST: RequestHandler = async (event) => {
	await auth.api.signOut({
		headers: event.request.headers
	});
	return json({ ok: true as const });
};
