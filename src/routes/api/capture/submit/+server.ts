import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { captureThought } from '$lib/server/capture/service';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
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

	// NDJSON streaming path.
	//
	// We run captureThought() directly in the request handler (not inside
	// ReadableStream.start) so SvelteKit / postgres.js never releases the DB
	// connection mid-pipeline. Progress lines are pushed to a TransformStream
	// whose readable side is handed straight to the Response — so each line
	// flushes to the client as soon as it is written, giving the user real-time
	// phase feedback instead of a single bulk response at the end.
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

	// Run capture work as a separate async task so we can return the Response
	// immediately (giving the browser its readable stream) while the work
	// continues writing progress lines into the TransformStream.
	const captureWork = (async () => {
		try {
			const thought = await runWithTrace(crypto.randomUUID(), () =>
				captureThought(user.id, raw, { onProgress })
			);
			writeRaw({ type: 'done', thought });
		} catch (err) {
			const details = collectErrorMessages(err);
			const message = details[0] ?? 'Failed to capture thought';
			console.error('capture submit failed', {
				userId: user.id,
				message,
				details
			});
			writeRaw({ type: 'error', error: message, details });
		} finally {
			await writer.close();
		}
	})();

	// Keep the request alive until the capture work finishes so the platform
	// (Node / Cloudflare) does not cut the DB connection or GC the response.
	event.request.signal.addEventListener('abort', () => {
		// Client disconnected early — close the writer to free resources.
		void writer.abort(new Error('client disconnected'));
	});

	void captureWork;

	return new Response(readable, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
