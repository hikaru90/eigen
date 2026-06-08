/**
 * POST /api/graph/rearrange
 *
 * Rearranges and cleans up the signed-in user's graph: prunes weak/orphan nodes and repairs relations.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runGraphRearrangeForUser } from '$lib/server/graph/run-graph-rearrange';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const accept = event.request.headers?.get('accept') ?? '';
	const streamNdjson = accept.includes('application/x-ndjson');

	if (!streamNdjson) {
		const result = await runGraphRearrangeForUser(user.id);
		return json({ ok: true as const, ...result });
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

	const rearrangeWork = (async () => {
		try {
			const result = await runGraphRearrangeForUser(user.id, async (event) => {
				writeRaw({
					type: 'progress',
					phase: event.phase,
					...(event.processed !== undefined ? { processed: event.processed } : {}),
					...(event.total !== undefined ? { total: event.total } : {})
				});
			});
			writeRaw({ type: 'done', result });
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Graph rearrange failed';
			console.error('graph rearrange failed', { userId: user.id, message });
			writeRaw({ type: 'error', error: message });
		} finally {
			await writer.close().catch(() => {});
		}
	})();

	rearrangeWork.catch((err) => {
		console.error('graph rearrange: rearrangeWork rejected', err);
		writer.close().catch(() => {});
	});

	event.request.signal.addEventListener('abort', () => {
		writer.abort(new Error('client disconnected')).catch(() => {});
	});

	return new Response(readable, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
