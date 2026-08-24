import { shouldScheduleDevCaptureEnrichWorker } from '$lib/server/auth/harness-account'
import { autoConfirmStaleAwaitingConfirmationDrafts } from '$lib/server/capture/capture-confirmation'
import { listPendingEnrichThoughtIds } from '$lib/server/capture/enrich-pending'
import {
  completeEnrichedQueueRows,
  recoverStaleEnrichProcessingRows,
  requeueInFlightProcessingRows,
  requeueOrphanedCompleteEnrichRows,
} from '$lib/server/capture/queue-capture'

export type SyncCaptureEnrichQueueResult = {
  finalizedEnriched: number
  recoveredStale: number
  requeuedInFlight: number
  requeuedOrphaned: number
  autoConfirmedDrafts: number
  activeThoughtIds: string[]
}

/** Requeue interrupted rows and return ids still waiting on tier-2 enrich. */
export async function syncCaptureEnrichQueue(
  userId: string,
): Promise<SyncCaptureEnrichQueueResult> {
  const finalizedEnriched = await completeEnrichedQueueRows(userId)
  const recoveredStale = await recoverStaleEnrichProcessingRows(userId)
  const { isCaptureEnrichWorkerActive } = await import('$lib/server/capture/capture-enrich-worker')
  const requeuedInFlight = isCaptureEnrichWorkerActive(userId)
    ? 0
    : await requeueInFlightProcessingRows(userId)
  const requeuedOrphaned = await requeueOrphanedCompleteEnrichRows(userId)
  const autoConfirmedDrafts = await autoConfirmStaleAwaitingConfirmationDrafts(userId)
  const activeThoughtIds = await listPendingEnrichThoughtIds(userId)
  return {
    finalizedEnriched,
    recoveredStale,
    requeuedInFlight,
    requeuedOrphaned,
    autoConfirmedDrafts,
    activeThoughtIds,
  }
}

/** Recover/requeue then schedule the dev worker when this tenant has queue work. */
export async function syncAndScheduleCaptureEnrichQueue(
  userId: string,
): Promise<SyncCaptureEnrichQueueResult> {
  const result = await syncCaptureEnrichQueue(userId)
  if (result.activeThoughtIds.length > 0 && (await shouldScheduleDevCaptureEnrichWorker(userId))) {
    const { scheduleCaptureEnrichWorker } =
      await import('$lib/server/capture/capture-enrich-worker')
    scheduleCaptureEnrichWorker(userId)
  }
  return result
}
