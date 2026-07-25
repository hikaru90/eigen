/// <reference lib="webworker" />
import type { EmbeddingSnapshotItem } from '../../routes/api/embeddings/snapshot/+server'
import {
  canRunUmap,
  centerAndScaleCoords3d,
  computeUmapNeighbors,
  fallbackProjection3d,
  l2NormalizeEmbeddings,
} from '../../routes/graph/embedding-projection'

type ReqMessage =
  | { type: 'project'; items: EmbeddingSnapshotItem[] }
  | { type: 'cancel' }

type DoneMessage = { type: 'done'; coords: number[][] }
type ProgressMessage = { type: 'progress'; epoch: number; totalEpochs: number }
type ErrorMessage = { type: 'error'; message: string }

type ResMessage = DoneMessage | ProgressMessage | ErrorMessage

let cancelled = false

function post(msg: ResMessage) {
  ;(self as unknown as Worker).postMessage(msg)
}

async function run(items: EmbeddingSnapshotItem[]): Promise<void> {
  cancelled = false
  if (items.length === 0) {
    post({ type: 'done', coords: [] })
    return
  }

  try {
    const embeddings = l2NormalizeEmbeddings(items)
    const nNeighbors = computeUmapNeighbors(items.length)
    const nEpochs = items.length > 200 ? 300 : 500

    let coords: number[][]
    if (canRunUmap(items.length, nNeighbors)) {
      const { UMAP } = await import('umap-js')
      const umap = new UMAP({
        nNeighbors,
        nEpochs,
        nComponents: 3,
        minDist: 0.1,
        spread: 1.0,
      })
      coords = await umap.fitAsync(embeddings, (epochNumber) => {
        if (cancelled) return false
        post({ type: 'progress', epoch: epochNumber, totalEpochs: nEpochs })
        return true
      })
      if (cancelled) return
    } else {
      coords = fallbackProjection3d(items.length)
    }

    const centered = centerAndScaleCoords3d(coords)
    if (cancelled) return
    post({ type: 'done', coords: centered })
  } catch (err) {
    if (cancelled) return
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

self.onmessage = (e: MessageEvent<ReqMessage>) => {
  const msg = e.data
  if (msg.type === 'cancel') {
    cancelled = true
    return
  }
  if (msg.type === 'project') {
    void run(msg.items)
  }
}
