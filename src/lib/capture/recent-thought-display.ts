import type {
  CaptureMemoryAuthor,
  CaptureRecentThoughtSnippet,
  CaptureSubmitResult,
} from '$lib/capture/capture-result-types'

export type CaptureAuthorFilter = 'all' | 'human' | 'agent'

/** Matches queueCapture placeholder until tier-2 classify runs. */
export const CAPTURE_QUEUE_PLACEHOLDER_CATEGORY = 'observation'

type RecentRow = {
  category: string
  memoryType: string | null
  enrichmentComplete?: boolean
  queueStatus?: CaptureSubmitResult['queueStatus']
}

function rowState(
  detail: CaptureSubmitResult | undefined,
  snippet: CaptureRecentThoughtSnippet | undefined,
): RecentRow {
  return {
    category: detail?.category ?? snippet?.category ?? '',
    memoryType: detail?.memoryType ?? snippet?.memoryType ?? null,
    enrichmentComplete: detail?.enrichmentComplete,
    queueStatus: detail?.queueStatus,
  }
}

/** Primary type chip for collapsed recent rows — avoids showing placeholder category after enrich. */
export function recentThoughtPrimaryLabel(
  detail: CaptureSubmitResult | undefined,
  snippet: CaptureRecentThoughtSnippet | undefined,
): string {
  const row = rowState(detail, snippet)
  if (row.memoryType) return row.memoryType
  if (row.enrichmentComplete && row.category === CAPTURE_QUEUE_PLACEHOLDER_CATEGORY) {
    return 'indexed'
  }
  if (
    !row.enrichmentComplete &&
    (row.queueStatus === 'pending' || row.queueStatus === 'processing')
  ) {
    return row.category || CAPTURE_QUEUE_PLACEHOLDER_CATEGORY
  }
  return row.category || 'thought'
}

/** Optional secondary label when category adds context beyond memory type. */
export function recentThoughtSecondaryLabel(
  detail: CaptureSubmitResult | undefined,
  snippet: CaptureRecentThoughtSnippet | undefined,
): string | null {
  const row = rowState(detail, snippet)
  if (!row.memoryType) return null
  if (row.category === CAPTURE_QUEUE_PLACEHOLDER_CATEGORY) return null
  if (row.category === row.memoryType) return null
  return row.category
}

export function captureThoughtAuthorship(
  detail: CaptureSubmitResult | undefined,
  snippet: CaptureRecentThoughtSnippet | undefined,
): { author: CaptureMemoryAuthor; authorLabel: string | null } {
  return {
    author: detail?.author ?? snippet?.author ?? 'user',
    authorLabel: detail?.authorLabel ?? snippet?.authorLabel ?? null,
  }
}

export function isAgentAuthoredCapture(
  detail: CaptureSubmitResult | undefined,
  snippet: CaptureRecentThoughtSnippet | undefined,
): boolean {
  return captureThoughtAuthorship(detail, snippet).author === 'agent'
}

export function matchesCaptureAuthorFilter(
  filter: CaptureAuthorFilter,
  detail: CaptureSubmitResult | undefined,
  snippet: CaptureRecentThoughtSnippet | undefined,
): boolean {
  if (filter === 'all') return true
  const isAgent = isAgentAuthoredCapture(detail, snippet)
  return filter === 'agent' ? isAgent : !isAgent
}

export function recentListHasAgentCaptures(
  thoughts: CaptureRecentThoughtSnippet[],
  thoughtDetails: Record<string, CaptureSubmitResult>,
): boolean {
  return thoughts.some((snippet) => isAgentAuthoredCapture(thoughtDetails[snippet.id], snippet))
}
