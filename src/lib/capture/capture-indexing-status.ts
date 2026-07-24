import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'

export type CaptureIndexingListStatus = {
  label: string
  spinning: boolean
  failed: boolean
}

/** List-row badge for recent capture thoughts. */
export function captureIndexingListStatus(
  detail: CaptureSubmitResult | undefined,
  activelyPolling: boolean,
): CaptureIndexingListStatus | null {
  if (!detail || detail.enrichmentComplete) return null

  if (detail.queueStatus === 'awaiting_confirmation') {
    return { label: 'Awaiting confirmation', spinning: false, failed: false }
  }
  if (detail.queueStatus === 'failed') {
    return { label: 'Indexing failed', spinning: false, failed: true }
  }
  if (detail.queueStatus === 'pending') {
    return { label: 'Waiting to index', spinning: false, failed: false }
  }
  if (detail.queueStatus === 'processing') {
    return { label: 'Indexing now', spinning: true, failed: false }
  }
  if (detail.queueStatus === 'complete') {
    return { label: 'Indexing incomplete', spinning: false, failed: true }
  }
  if (activelyPolling) {
    return { label: 'Indexing in background', spinning: true, failed: false }
  }
  return null
}

/** Detail-card footnote under stored thought summary. */
export function captureIndexingDetailMessage(
  thought: Pick<CaptureSubmitResult, 'enrichmentComplete' | 'queueStatus' | 'queueError'>,
): string | null {
  if (thought.enrichmentComplete) return null

  if (thought.queueStatus === 'awaiting_confirmation') {
    return 'Confirm how this capture should be stored before indexing starts.'
  }
  if (thought.queueStatus === 'pending') {
    return 'Queue: waiting for indexing'
  }
  if (thought.queueStatus === 'processing') {
    return 'Queue: indexing now'
  }
  if (thought.queueStatus === 'failed') {
    return `Indexing failed${thought.queueError ? `: ${thought.queueError}` : ''}`
  }
  if (thought.queueStatus === 'complete') {
    return 'Indexing did not finish — use Retry to complete entity links and semantic search.'
  }
  return 'Saved — indexing entities and links in the background. Keyword search on the text works now; semantic search after indexing completes.'
}

export function captureIndexingRetryEligible(
  detail: CaptureSubmitResult | undefined,
  listStatus: CaptureIndexingListStatus | null,
): boolean {
  if (!detail || detail.enrichmentComplete) return false
  if (detail.queueStatus === 'awaiting_confirmation') return false
  if (detail.queueStatus === 'failed') return true
  if (detail.queueStatus === 'pending' || detail.queueStatus === 'processing') return true
  if (detail.queueStatus === 'complete') return true
  return listStatus !== null
}
