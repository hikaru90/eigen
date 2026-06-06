import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRecentCaptureThoughts } from '$lib/server/capture/load-recent-capture-thoughts';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const payload = await loadRecentCaptureThoughts(user.id);
	return json(payload);
};
