/**
 * Background worker: drain pending enrich queue per user.
 */
import { withDbUser } from '$lib/server/db';
import { drainCaptureEnrichQueue } from '$lib/server/capture/enrich-queue-drain';

const activeWorkers = new Map<string, Promise<void>>();

export function scheduleCaptureEnrichWorker(userId: string): void {
	if (activeWorkers.has(userId)) return;

	const work = withDbUser(userId, async () => {
		try {
			await drainCaptureEnrichQueue(userId);
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
