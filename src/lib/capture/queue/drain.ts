import type { CaptureQueueBroadcast, CaptureSubmitResult } from './types'
import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson'
import { getNextPendingCaptureItem, setCaptureQueueStatus } from './db'
import { processCaptureQueueItem } from './process-item'
import { buildCaptureQueueSnapshot } from './snapshot'
import { registerCaptureQueueBackgroundSync } from './sync-registration'

export type DrainCaptureQueueOptions = {
  signal?: AbortSignal
  onProgress?: (id: string, event: ProgressEvent) => void
  streamProgress?: boolean
  broadcast?: (message: CaptureQueueBroadcast) => void
}

export type DrainCaptureQueueResult = {
  processed: number
  stoppedForOffline: boolean
}

/** Processes pending capture queue items one at a time until empty or offline. */
export async function drainCaptureQueue(
  options?: DrainCaptureQueueOptions,
): Promise<DrainCaptureQueueResult> {
  let processed = 0
  let stoppedForOffline = false

  while (!options?.signal?.aborted) {
    options?.broadcast?.(await buildCaptureQueueSnapshot())

    const item = await getNextPendingCaptureItem()
    if (!item) {
      options?.broadcast?.({ type: 'idle' })
      break
    }

    await setCaptureQueueStatus(item.id, 'processing')
    options?.broadcast?.(await buildCaptureQueueSnapshot())
    options?.broadcast?.({ type: 'active', id: item.id, raw: item.raw })

    let result: Awaited<ReturnType<typeof processCaptureQueueItem>>
    try {
      result = await processCaptureQueueItem(item, {
        signal: options?.signal,
        streamProgress: options?.streamProgress,
        onProgress: (event) => {
          options?.onProgress?.(item.id, event)
          options?.broadcast?.({ type: 'progress', id: item.id, event })
        },
      })
    } catch (err) {
      if (options?.signal?.aborted) {
        options?.broadcast?.(await buildCaptureQueueSnapshot())
        continue
      }
      throw err
    }

    if (result.outcome === 'done') {
      processed += 1
      options?.broadcast?.({
        type: 'done',
        id: item.id,
        thought: result.thought as CaptureSubmitResult,
      })
      options?.broadcast?.(await buildCaptureQueueSnapshot())
      continue
    }

    if (result.outcome === 'offline') {
      stoppedForOffline = true
      await registerCaptureQueueBackgroundSync()
      options?.broadcast?.(await buildCaptureQueueSnapshot())
      options?.broadcast?.({ type: 'idle' })
      break
    }

    if (result.outcome === 'retry') {
      continue
    }

    if (result.outcome === 'failed') {
      options?.broadcast?.({ type: 'failed', id: item.id, error: result.error })
      options?.broadcast?.(await buildCaptureQueueSnapshot())
    }
  }

  return { processed, stoppedForOffline }
}
