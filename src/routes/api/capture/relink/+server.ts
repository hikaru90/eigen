import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { relinkThoughtGraph } from '$lib/server/capture/service';
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
		typeof body === 'object' && body ? (body as { thoughtId?: unknown }) : {};
	const thoughtId = typeof b.thoughtId === 'string' ? b.thoughtId : '';
	if (!thoughtId.trim()) error(400, 'thoughtId is required');

	const accept = event.request.headers?.get('accept') ?? '';
	const streamNdjson = accept.includes('application/x-ndjson');

	if (!streamNdjson) {
		const result = await runWithTrace(crypto.randomUUID(), () =>
			relinkThoughtGraph(user.id, thoughtId)
		);
		if (!result.ok) error(404, 'Thought not found');
		return json({ thought: result.thought });
	}

	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const line = (payload: unknown) => {
		chunks.push(encoder.encode(`${JSON.stringify(payload)}\n`));
	};
	try {
		const result = await runWithTrace(crypto.randomUUID(), () =>
			relinkThoughtGraph(user.id, thoughtId, {
				onProgress: (phase) => line({ type: 'progress', phase })
			})
		);
		if (!result.ok) {
			line({ type: 'error', error: 'Thought not found', details: [] });
		} else {
			line({ type: 'done', thought: result.thought });
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to relink thought';
		console.error('capture relink failed', { userId: user.id, thoughtId, message });
		line({ type: 'error', error: message, details: [] });
	}
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const ndjsonBytes = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		ndjsonBytes.set(c, offset);
		offset += c.length;
	}
	return new Response(ndjsonBytes, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
