/**
 * Background worker: drain pending enrich queue per user.
 */
import { withDbUser } from '$lib/server/db';
import { claimNextPendingThought } from '$lib/server/capture/queue-capture';
import { enrichQueuedThought } from '$lib/server/capture/enrich-queued-thought';

const activeWorkers = new Map<string, Promise<void>>();

export function scheduleCaptureEnrichWorker(userId: string): void {
	if (activeWorkers.has(userId)) return;

	const work = withDbUser(userId, async () => {
		try {
			for (;;) {
				const claimed = await claimNextPendingThought(userId);
				if (!claimed) break;
				await enrichQueuedThought(userId, claimed.id);
			}
		} finally {
			activeWorkers.delete(userId);
		}
	}).catch((err) => {
		activeWorkers.delete(userId);
		console.error('[capture-enrich-worker] worker failed', {
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
	});

	activeWorkers.set(userId, work);
}

export async function awaitCaptureEnrichWorkerIdle(userId: string): Promise<void> {
	const pending = activeWorkers.get(userId);
	if (pending) await pending;
}
