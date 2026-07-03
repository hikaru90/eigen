/**
 * Background worker: drain pending enrich queue per user.
 */
import { shouldScheduleDevCaptureEnrichWorker } from '$lib/server/auth/harness-account';
import { withDbUser } from '$lib/server/db';
import { drainCaptureEnrichQueue } from '$lib/server/capture/enrich-queue-drain';

const activeWorkers = new Map<string, Promise<void>>();

export function scheduleCaptureEnrichWorker(userId: string): void {
	if (activeWorkers.has(userId)) return;

	const work = shouldScheduleDevCaptureEnrichWorker(userId)
		.then(async (allowed) => {
			if (!allowed) return;
			return withDbUser(userId, async () => {
				await drainCaptureEnrichQueue(userId);
			});
		})
		.catch((err) => {
			console.error('[capture-enrich-worker] worker failed', {
				userId,
				message: err instanceof Error ? err.message : String(err)
			});
		})
		.finally(() => {
			activeWorkers.delete(userId);
		});

	activeWorkers.set(userId, work);
}

export async function awaitCaptureEnrichWorkerIdle(userId: string): Promise<void> {
	const pending = activeWorkers.get(userId);
	if (pending) await pending;
}
