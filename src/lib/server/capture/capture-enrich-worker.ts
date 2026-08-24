/**
 * Background worker: drain pending enrich queue per user.
 */
import { shouldScheduleDevCaptureEnrichWorker } from '$lib/server/auth/harness-account'
import { drainCaptureEnrichQueue } from '$lib/server/capture/enrich-queue-drain'
import { syncCaptureEnrichQueue } from '$lib/server/capture/sync-capture-enrich-queue'
import { withDbUser } from '$lib/server/db'

const activeWorkers = new Map<string, Promise<void>>()

export function isCaptureEnrichWorkerActive(userId: string): boolean {
  return activeWorkers.has(userId)
}

export function scheduleCaptureEnrichWorker(userId: string): void {
  if (activeWorkers.has(userId)) return

  const work = shouldScheduleDevCaptureEnrichWorker(userId)
    .then(async (allowed) => {
      if (!allowed) return
      return withDbUser(userId, async () => {
        await syncCaptureEnrichQueue(userId)
        await drainCaptureEnrichQueue(userId)
      })
    })
    .catch((err) => {
      console.error('[capture-enrich-worker] worker failed', {
        userId,
        message: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => {
      activeWorkers.delete(userId)
    })

  activeWorkers.set(userId, work)
}

export async function awaitCaptureEnrichWorkerIdle(userId: string): Promise<void> {
  const pending = activeWorkers.get(userId)
  if (pending) await pending
}
