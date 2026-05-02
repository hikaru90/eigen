import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { editStoredThought } from '$lib/server/capture/service';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		error(400, 'Invalid JSON');
	}

	const b =
		typeof body === 'object' && body
			? (body as { thoughtId?: unknown; editRequest?: unknown })
			: {};
	const thoughtId = typeof b.thoughtId === 'string' ? b.thoughtId : '';
	const editRequest = typeof b.editRequest === 'string' ? b.editRequest : '';
	if (!thoughtId) error(400, 'thoughtId is required');
	if (!editRequest.trim()) error(400, 'editRequest is required');

	const result = await editStoredThought(user.id, thoughtId, editRequest);
	if (!result.ok) error(404, 'Thought not found');

	return json({ thought: result.thought });
};
