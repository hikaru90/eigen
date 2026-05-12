import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { editStoredThought } from '$lib/server/capture/service';
import { runWithTrace } from '$lib/server/activity/trace-context';

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

	const accept = event.request.headers?.get('accept') ?? '';
	const streamNdjson = accept.includes('application/x-ndjson');

	if (!streamNdjson) {
		const result = await runWithTrace(crypto.randomUUID(), () => editStoredThought(user.id, thoughtId, editRequest));
		if (!result.ok) error(404, 'Thought not found');

		return json({ thought: result.thought });
	}

	const encoder = new TextEncoder();
	const bodyStream = new ReadableStream({
		async start(controller) {
			const line = (payload: unknown) =>
				controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
			try {
				const result = await runWithTrace(crypto.randomUUID(), () => editStoredThought(user.id, thoughtId, editRequest, {
					onProgress: (phase) => line({ type: 'progress', phase })
				}));
				if (!result.ok) {
					line({ type: 'error', error: 'Thought not found', details: [] });
					return;
				}
				line({ type: 'done', thought: result.thought });
			} catch (err) {
				const message = err instanceof Error ? err.message : 'Failed to update thought';
				console.error('capture edit failed', { userId: user.id, thoughtId, message });
				line({ type: 'error', error: message, details: [] });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(bodyStream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
