import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { editStoredThought } from '$lib/server/capture/service';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
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

	// NDJSON streaming path — same pattern as the submit endpoint.
	const encoder = new TextEncoder();
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();

	const writeRaw = (payload: unknown) => {
		void writer.write(encoder.encode(`${JSON.stringify(payload)}\n`));
	};

	const onProgress = (event: CaptureProgressEvent) => {
		if (event.parallel) {
			writeRaw({ type: 'progress_parallel', phases: event.phases });
		} else {
			writeRaw({ type: 'progress', phase: event.phase });
		}
	};

	const editWork = (async () => {
		try {
			const result = await runWithTrace(crypto.randomUUID(), () =>
				editStoredThought(user.id, thoughtId, editRequest, { onProgress })
			);
			if (!result.ok) {
				writeRaw({ type: 'error', error: 'Thought not found', details: [] });
			} else {
				writeRaw({ type: 'done', thought: result.thought });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to update thought';
			console.error('capture edit failed', { userId: user.id, thoughtId, message });
			writeRaw({ type: 'error', error: message, details: [] });
		} finally {
			await writer.close();
		}
	})();

	event.request.signal.addEventListener('abort', () => {
		void writer.abort(new Error('client disconnected'));
	});

	void editWork;

	return new Response(readable, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
