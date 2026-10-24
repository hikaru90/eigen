import type { CaptureSubmitResult } from './capture-result-types'

/**
 * After Capture: where the kept thought is. saving = the keep call is in flight;
 * indexing = stored, the background pass (entities, embedding, graph) is running;
 * linked = done; failed = the background pass failed (the thought stays kept).
 */
export type KeptStage = 'saving' | 'indexing' | 'linked' | 'failed'

/** Poll cadence and ceiling for the indexing stage (~90 s, then it says it is still working). */
export const KEPT_POLL_MS = 1500
export const KEPT_POLL_MAX_TRIES = 60

/** How long the linked strip stays before it fades (a failure stays until the next capture). */
export const KEPT_LINKED_FADE_MS = 6_000

export function keptStage(
  result: Pick<CaptureSubmitResult, 'queueStatus' | 'enrichmentComplete'>,
): KeptStage {
  if (result.queueStatus === 'failed') return 'failed'
  if (result.queueStatus === 'complete' || result.enrichmentComplete) return 'linked'
  return 'indexing'
}
