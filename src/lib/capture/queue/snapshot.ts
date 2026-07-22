import { listCaptureQueueItems } from './db'
import type { CaptureQueueBroadcast, CaptureQueueItem } from './types'

export type CaptureQueueSnapshotMessage = Extract<CaptureQueueBroadcast, { type: 'snapshot' }>

export async function buildCaptureQueueSnapshot(): Promise<CaptureQueueSnapshotMessage> {
  const items = await listCaptureQueueItems()
  return {
    type: 'snapshot',
    items,
    pending: items.filter((i) => i.status === 'pending').length,
    processingId: items.find((i) => i.status === 'processing')?.id ?? null,
  }
}

export function captureQueueItemPreview(raw: string, max = 72): string {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function captureQueueStatusLabel(status: CaptureQueueItem['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting'
    case 'processing':
      return 'Capturing'
    case 'failed':
      return 'Failed'
  }
}
