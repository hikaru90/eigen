import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { captureThought } from '$lib/server/capture/service';
import { runWithTrace } from '$lib/server/activity/trace-context';

function collectErrorMessages(input: unknown): string[] {
	const parts: string[] = [];
	let current = input;
	let guard = 0;
	while (current && guard < 8) {
		guard += 1;
		if (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
			continue;
		}
		if (typeof current === 'object' && current) {
			const msg = 'message' in current ? (current as { message?: unknown }).message : undefined;
			if (typeof msg === 'string' && msg.trim().length > 0) {
				parts.push(msg);
			}
			current = 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
			continue;
		}
		break;
	}
	return parts.filter((v, i, arr) => v && arr.indexOf(v) === i);
}

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

	const accept = event.request.headers?.get('accept') ?? '';
	const streamNdjson = accept.includes('application/x-ndjson');

	if (!streamNdjson) {
		try {
			const thought = await runWithTrace(crypto.randomUUID(), () => captureThought(user.id, raw));
			return json({ thought });
		} catch (err) {
			const details = collectErrorMessages(err);
			const message = details[0] ?? 'Failed to capture thought';
			console.error('capture submit failed', {
				userId: user.id,
				message,
				details
			});
			return json({ error: message, details }, { status: 500 });
		}
	}

	// Run capture in the request handler (not inside ReadableStream.start). Otherwise SvelteKit
	// resolves the POST before the stream body finishes, hooks.server releases the reserved DB
	// connection, and ingest can hang mid-pipeline waiting on postgres.js.
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const line = (payload: unknown) => {
		chunks.push(encoder.encode(`${JSON.stringify(payload)}\n`));
	};
	try {
		const thought = await runWithTrace(crypto.randomUUID(), () =>
			captureThought(user.id, raw, {
				onProgress: (phase) => line({ type: 'progress', phase })
			})
		);
		line({ type: 'done', thought });
	} catch (err) {
		const details = collectErrorMessages(err);
		const message = details[0] ?? 'Failed to capture thought';
		console.error('capture submit failed', {
			userId: user.id,
			message,
			details
		});
		line({ type: 'error', error: message, details });
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
