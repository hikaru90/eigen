import { randomUuid } from '$lib/random-uuid'
import {
  deleteCaptureQueueItem,
  enqueueCaptureRaw,
  listCaptureQueueItems,
  recoverStuckProcessingCaptureItems,
  releaseCaptureQueueDrainLock,
  tryAcquireCaptureQueueDrainLock,
} from './db'
import { buildCaptureQueueSnapshot } from './snapshot'
import { drainCaptureQueue } from './drain'
import { registerCaptureQueueBackgroundSync } from './sync-registration'
import {
  CAPTURE_QUEUE_CHANNEL,
  type CaptureQueueBroadcast,
  type CaptureQueueItem,
  type CaptureSubmitResult,
} from './types'
import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson'

type RunnerListener = (message: CaptureQueueBroadcast) => void

let started = false
let draining = false
let drainingItemId: string | null = null
let activeAbort: AbortController | null = null
const listeners = new Set<RunnerListener>()
let channel: BroadcastChannel | null = null

/** Identifies this tab so BroadcastChannel echoes are not delivered twice locally. */
const tabOrigin = randomUuid()

type CaptureQueueBroadcastWire = CaptureQueueBroadcast & { _origin?: string }

function notifyListeners(message: CaptureQueueBroadcast) {
  for (const listener of listeners) listener(message)
}

/**
 * Notify subscribers in this tab synchronously, then fan out to other tabs.
 * Previously only postMessage was used when BroadcastChannel existed, so progress
 * events could be dropped if they were handled before the async `active` message.
 */
function emit(message: CaptureQueueBroadcast) {
  notifyListeners(message)
  if (channel) {
    channel.postMessage({ ...message, _origin: tabOrigin } satisfies CaptureQueueBroadcastWire)
  }
}

function ensureChannel() {
  if (typeof BroadcastChannel === 'undefined') return
  if (!channel) {
    channel = new BroadcastChannel(CAPTURE_QUEUE_CHANNEL)
    channel.onmessage = (event: MessageEvent<CaptureQueueBroadcastWire>) => {
      const data = event.data
      if (!data || typeof data !== 'object' || !('type' in data)) return
      if (data._origin === tabOrigin) return
      const { _origin: _, ...message } = data
      notifyListeners(message)
    }
  }
}

export function subscribeCaptureQueue(listener: RunnerListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function getCaptureQueueSnapshot(): Promise<{
  items: CaptureQueueItem[]
  pending: number
  processingId: string | null
}> {
  const items = await listCaptureQueueItems()
  const processingId = items.find((i) => i.status === 'processing')?.id ?? null
  return {
    items,
    pending: items.filter((i) => i.status === 'pending').length,
    processingId,
  }
}

async function kickDrain() {
  if (draining) return
  if (!(await tryAcquireCaptureQueueDrainLock(tabOrigin))) {
    return
  }
  draining = true
  const ac = new AbortController()
  activeAbort = ac
  try {
    await drainCaptureQueue({
      signal: ac.signal,
      streamProgress: true,
      broadcast: (message) => {
        if (message.type === 'active') drainingItemId = message.id
        if (message.type === 'done' || message.type === 'failed' || message.type === 'idle') {
          drainingItemId = null
        }
        emit(message)
      },
    })
  } finally {
    draining = false
    drainingItemId = null
    if (activeAbort === ac) activeAbort = null
    await releaseCaptureQueueDrainLock(tabOrigin)
  }
}

export async function enqueueCapture(raw: string): Promise<CaptureQueueItem> {
  const item = await enqueueCaptureRaw(raw)
  emit(await buildCaptureQueueSnapshot())
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await registerCaptureQueueBackgroundSync()
  } else {
    void kickDrain()
  }
  return item
}

function cancelActiveCapture(): void {
  activeAbort?.abort()
  activeAbort = null
}

/** Remove one queued capture; aborts in-flight work when cancelling the active item. */
export async function cancelCaptureQueueItem(id: string): Promise<void> {
  await deleteCaptureQueueItem(id)
  if (drainingItemId === id) {
    cancelActiveCapture()
  }
  emit(await buildCaptureQueueSnapshot())
}

export function startCaptureQueueRunner(): void {
  if (started || typeof window === 'undefined') return
  started = true
  ensureChannel()

  const onOnline = () => {
    void kickDrain()
  }
  window.addEventListener('online', onOnline)

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data
      if (data && typeof data === 'object' && 'type' in data) {
        if ((data as { type?: string }).type === 'DRAIN_CAPTURE_QUEUE') {
          void kickDrain()
          return
        }
        emit(data as CaptureQueueBroadcast)
      }
      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        (data as { type?: string }).type === 'capture-queue-idle'
      ) {
        void (async () => {
          const snap = await getCaptureQueueSnapshot()
          if (snap.pending > 0 || snap.processingId) void kickDrain()
        })()
      }
    })
  }

  void (async () => {
    await recoverStuckProcessingCaptureItems()
    const snap = await getCaptureQueueSnapshot()
    if (snap.pending > 0 || snap.processingId) {
      emit(await buildCaptureQueueSnapshot())
      void kickDrain()
    }
  })()
}

export type { CaptureSubmitResult, ProgressEvent }
