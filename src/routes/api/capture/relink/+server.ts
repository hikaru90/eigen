import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { relinkThoughtGraph } from '$lib/server/capture/service';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
import { runWithTrace } from '$lib/server/activity/trace-context';
import { appSql, appDbAsyncLocal, createScopedDrizzle, activateTenantDbSession, deactivateTenantDbSession } from '$lib/server/db';

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
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>(
		{},
		{ highWaterMark: 64 }
	);
	const writer = writable.getWriter();

	const writeRaw = (payload: unknown) => {
		writer.write(encoder.encode(`${JSON.stringify(payload)}\n`)).catch(() => {});
	};

	const onProgress = async (ev: CaptureProgressEvent) => {
		if (ev.parallel) {
			writeRaw({ type: 'progress_parallel', phases: ev.phases });
		} else {
			writeRaw({ type: 'progress', phase: ev.phase });
		}
	};

	const relinkWork = (async () => {
		let reserved: Awaited<ReturnType<typeof appSql.reserve>> | null = null;
		try {
			reserved = await appSql.reserve();
			await activateTenantDbSession(reserved, user.id);
			const scopedDb = createScopedDrizzle(reserved);
			const result = await appDbAsyncLocal.run(scopedDb, () =>
				runWithTrace(crypto.randomUUID(), () =>
					relinkThoughtGraph(user.id, thoughtId, { onProgress })
				)
			);
			if (!result.ok) {
				writeRaw({ type: 'error', error: 'Thought not found', details: [] });
			} else {
				writeRaw({ type: 'done', thought: result.thought });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to relink thought';
			console.error('capture relink failed', { userId: user.id, thoughtId, message });
			writeRaw({ type: 'error', error: message, details: [] });
		} finally {
			if (reserved) {
				await deactivateTenantDbSession(reserved).catch(() => {});
				await reserved.release();
			}
			await writer.close().catch(() => {});
		}
	})();

	relinkWork.catch((err) => {
		console.error('capture relink: relinkWork rejected', err);
		writer.close().catch(() => {});
	});

	event.request.signal.addEventListener('abort', () => {
		writer.abort(new Error('client disconnected')).catch(() => {});
	});

	return new Response(readable, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
