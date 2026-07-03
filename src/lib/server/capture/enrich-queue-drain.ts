import {
	claimNextPendingThought,
	countPendingEnrichRows
} from '$lib/server/capture/queue-capture';
import { resolveCaptureEnrichConcurrency } from '$lib/server/orchestration-concurrency';
import { isFatalIngestError } from '$lib/server/ingest/retry';

export { resolveCaptureEnrichConcurrency, DEFAULT_ORCHESTRATION_CONCURRENCY } from '$lib/server/orchestration-concurrency';

const DEFAULT_IDLE_POLL_MS = 250;
const DEFAULT_IDLE_ROUNDS_BEFORE_EXIT = 4;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DrainCaptureEnrichQueueOptions = {
	concurrency?: number;
	claim?: typeof claimNextPendingThought;
	enrich?: (userId: string, thoughtId: string) => Promise<void>;
	countPending?: (userId: string) => Promise<number>;
	idlePollMs?: number;
	idleRoundsBeforeExit?: number;
	onProcessed?: (processed: number, totalHint?: number) => void;
};

/** Drain pending enrich rows with bounded worker concurrency. */
export async function drainCaptureEnrichQueue(
	userId: string,
	options?: DrainCaptureEnrichQueueOptions
): Promise<number> {
	const concurrency = resolveCaptureEnrichConcurrency(options?.concurrency);
	const claim = options?.claim ?? claimNextPendingThought;
	const countPending = options?.countPending ?? countPendingEnrichRows;
	const idlePollMs = options?.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
	const idleRoundsBeforeExit = options?.idleRoundsBeforeExit ?? DEFAULT_IDLE_ROUNDS_BEFORE_EXIT;
	const enrich =
		options?.enrich ??
		(await import('$lib/server/capture/enrich-queued-thought')).enrichQueuedThought;
	const onProcessed = options?.onProcessed;
	let processed = 0;
	let activeEnrich = 0;
	let totalHint: number | undefined;

	// Workers poll when the queue is momentarily empty so captures that land mid-drain
	// (e.g. rapid MCP capture_thought calls) are picked up by idle workers instead of
	// waiting for a single survivor to finish sequentially.
	async function worker(): Promise<void> {
		let idleRounds = 0;
		for (;;) {
			const claimed = await claim(userId);
			if (!claimed) {
				idleRounds += 1;
				if (idleRounds >= idleRoundsBeforeExit) {
					const pending = await countPending(userId);
					if (pending === 0 && activeEnrich === 0) return;
					idleRounds = 0;
				}
				await sleep(idlePollMs);
				continue;
			}

			idleRounds = 0;
			activeEnrich += 1;
			try {
				await enrich(userId, claimed.id);
				processed += 1;
				if (totalHint == null) {
					totalHint = processed + (await countPending(userId));
				}
				onProcessed?.(processed, totalHint);
			} catch (err) {
				// Fatal errors (e.g. 402 billing) stop the entire drain — no point retrying other thoughts
				if (isFatalIngestError(err)) {
					console.error('[enrich-drain] fatal error, stopping queue:', err.message);
					throw err;
				}
				// Non-fatal errors (e.g. transient LLM failures) — continue with next thought
			} finally {
				activeEnrich -= 1;
			}
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return processed;
}
