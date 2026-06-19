import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isInsufficientCreditsError, insufficientCreditsPayload } from '$lib/server/billing/insufficient-credits';
import {
	captureGateHttpStatus,
	captureGateJsonBody
} from '$lib/server/onboarding/capture-gate';
import { captureThought } from '$lib/server/capture/service';
import type { CaptureProgressEvent } from '$lib/server/capture/service';
import { parseOptionalIsoTimestamp } from '$lib/server/datetime/parse-iso';
import { runWithTrace } from '$lib/server/activity/trace-context';
import { appSql, appDbAsyncLocal, createScopedDrizzle, activateTenantDbSession, deactivateTenantDbSession } from '$lib/server/db';

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

	let capturedAt: Date | undefined;
	try {
		capturedAt =
			typeof body === 'object' && body
				? parseOptionalIsoTimestamp((body as { captured_at?: unknown }).captured_at, 'captured_at')
				: undefined;
	} catch (err) {
		error(400, err instanceof Error ? err.message : 'Invalid captured_at');
	}

	const captureOpts = { source: 'ui' as const, ...(capturedAt ? { capturedAt } : {}) };

	const accept = event.request.headers?.get('accept') ?? '';
	const streamNdjson = accept.includes('application/x-ndjson');

	if (!streamNdjson) {
		try {
			const thought = await runWithTrace(crypto.randomUUID(), () =>
				captureThought(user.id, raw, captureOpts)
			);
			return json({ thought });
		} catch (err) {
			const details = collectErrorMessages(err);
			const message = details[0] ?? 'Failed to capture thought';
			console.error('capture submit failed', { userId: user.id, message, details });
			return json(
				{ ...captureGateJsonBody(err, message), details },
				{ status: captureGateHttpStatus(err) }
			);
		}
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

	// The streaming path returns the Response immediately, which causes hooks.server to
	// release the request-scoped reserved DB connection before captureWork finishes.
	// Reserve a dedicated connection for tier-1 queue insert (returns before background enrich).
	const captureWork = (async () => {
		let reserved: Awaited<ReturnType<typeof appSql.reserve>> | null = null;
		try {
			reserved = await appSql.reserve();
			await activateTenantDbSession(reserved, user.id);
			const scopedDb = createScopedDrizzle(reserved);
			const thought = await appDbAsyncLocal.run(scopedDb, () =>
				runWithTrace(crypto.randomUUID(), () =>
					captureThought(user.id, raw, { ...captureOpts, onProgress })
				)
			);
			writeRaw({ type: 'done', thought });
		} catch (err) {
			const details = collectErrorMessages(err);
			const message = details[0] ?? 'Failed to capture thought';
			console.error('capture submit failed', { userId: user.id, message, details });
			writeRaw({
				type: 'error',
				error: message,
				details,
				...(isInsufficientCreditsError(err) ? insufficientCreditsPayload(err) : {})
			});
		} finally {
			if (reserved) {
				await deactivateTenantDbSession(reserved).catch(() => {});
				await reserved.release();
			}
			await writer.close().catch(() => {});
		}
	})();

	captureWork.catch((err) => {
		console.error('capture submit: captureWork rejected', err);
		writer.close().catch(() => {});
	});

	event.request.signal.addEventListener('abort', () => {
		writer.abort(new Error('client disconnected')).catch(() => {});
	});

	return new Response(readable, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8' }
	});
};
