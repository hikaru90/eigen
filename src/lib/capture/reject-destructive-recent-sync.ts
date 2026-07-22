import type {
  CaptureRecentThoughtSnippet,
  CaptureSubmitResult,
} from '$lib/capture/capture-result-types'

/** Block poll syncs that would wipe in-flight local captures before the server list catches up. */
export function shouldRejectDestructiveRecentSync(
  localSnippets: CaptureRecentThoughtSnippet[],
  localDetails: Record<string, CaptureSubmitResult>,
  mergedSnippets: CaptureRecentThoughtSnippet[],
): boolean {
  if (mergedSnippets.length > 0) return false
  return localSnippets.some((row) => {
    const detail = localDetails[row.id]
    return detail === undefined || !detail.enrichmentComplete
  })
}
