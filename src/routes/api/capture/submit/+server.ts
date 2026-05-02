import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { captureThought } from '$lib/server/capture/service';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const raw =
		typeof body === 'object' && body && 'raw' in body ? String((body as { raw?: unknown }).raw) : '';
	if (!raw.trim()) error(400, 'raw is required');

	const thought = await captureThought(user.id, raw);
	return json({ thought });
};
