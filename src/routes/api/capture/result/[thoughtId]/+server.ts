import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const thoughtId = event.params.thoughtId?.trim() ?? '';
	if (!thoughtId) error(400, 'thoughtId is required');

	try {
		const thought = await loadThoughtCaptureResult(user.id, thoughtId);
		return json({ thought });
	} catch {
		error(404, 'Thought not found');
	}
};
