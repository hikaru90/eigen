import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson'
import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'

export type { CaptureSubmitResult }

export const CAPTURE_QUEUE_DB_NAME = 'eigen-capture-queue'
export const CAPTURE_QUEUE_DB_VERSION = 1
export const CAPTURE_QUEUE_STORE = 'items'
export const CAPTURE_QUEUE_SYNC_TAG = 'eigen-capture-queue-sync'
export const CAPTURE_QUEUE_CHANNEL = 'eigen-capture-queue'
/** Background drain retries (initial attempt is not counted here). */
export const MAX_BACKGROUND_CAPTURE_ATTEMPTS = 3
/** Reserved IndexedDB row — excluded from queue listings. */
export const CAPTURE_QUEUE_DRAIN_LOCK_ID = '__drain_lock__'

export type CaptureQueueStatus = 'pending' | 'processing' | 'failed'

export type CaptureQueueItem = {
  id: string
  raw: string
  createdAt: number
  status: CaptureQueueStatus
  attempts: number
  lastError?: string
}

export type CaptureQueueBroadcast =
  | { type: 'active'; id: string; raw: string }
  | { type: 'progress'; id: string; event: ProgressEvent }
  | { type: 'done'; id: string; thought: CaptureSubmitResult }
  | { type: 'failed'; id: string; error: string }
  | { type: 'idle' }
  | {
      type: 'snapshot'
      items: CaptureQueueItem[]
      pending: number
      processingId: string | null
    }
