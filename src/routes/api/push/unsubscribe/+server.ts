import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deletePushSubscriptionByEndpoint } from '$lib/server/push/subscription';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Expected JSON body');
	}

	if (!body || typeof body !== 'object') error(400, 'Expected JSON object');
	const endpoint =
		'endpoint' in body && typeof (body as { endpoint?: unknown }).endpoint === 'string'
			? (body as { endpoint: string }).endpoint.trim()
			: '';
	if (!endpoint) error(400, 'endpoint is required');

	try {
		const removed = await deletePushSubscriptionByEndpoint(endpoint);
		return json({ ok: true as const, removed });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		error(500, msg);
	}
};
