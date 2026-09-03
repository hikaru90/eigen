import type { EmbeddingSnapshotItem } from '../../routes/api/embeddings/snapshot/+server'

export type EmbeddingProjectionPhase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'projecting'; epoch: number; totalEpochs: number }
  | { kind: 'ready'; revision: string; items: EmbeddingSnapshotItem[]; coords: number[][] }
  | { kind: 'error'; message: string }

type EmbeddingRevisionResponse = { revision: string }
type EmbeddingSnapshotResponse = { revision: string; items: EmbeddingSnapshotItem[] }
type ProjectedEmbeddingResponse = {
  revision: string
  coords: number[][]
  method: 'umap' | 'fallback'
}

type Listener = (phase: EmbeddingProjectionPhase) => void

const MAX_FETCH_RETRIES = 3
const CANCELLED = 'cancelled'

let cachedRevision: string | null = null
let cachedItems: EmbeddingSnapshotItem[] = []
let cachedCoords: number[][] = []
let inFlight: Promise<void> | null = null
let runGeneration = 0
let phase: EmbeddingProjectionPhase = { kind: 'idle' }
const listeners = new Set<Listener>()

/** Abstraction over the UMAP run so the main thread never blocks and runs can be interrupted. */
type EmbeddingProjector = {
  start(
    items: EmbeddingSnapshotItem[],
    onProgress: (epoch: number, totalEpochs: number) => void,
    signal: { cancelled: boolean },
    resolve: (coords: number[][]) => void,
    reject: (err: Error) => void,
  ): void
  cancel(): void
  dispose(): void
}

let projector: EmbeddingProjector | null = null
let projectorFactory: (() => EmbeddingProjector) | null = null

function defaultProjectorFactory(): EmbeddingProjector {
  return new WorkerProjector()
}

function getProjector(): EmbeddingProjector {
  if (!projector) {
    projector = (projectorFactory ?? defaultProjectorFactory)()
  }
  return projector
}

/** Test-only: inject a fake projector. Pass null to restore the default. */
export function __setEmbeddingProjectorForTests(factory: (() => EmbeddingProjector) | null): void {
  projector?.dispose()
  projector = null
  projectorFactory = factory
}

class WorkerProjector implements EmbeddingProjector {
  private worker: Worker | null = null
  private currentReject: ((err: Error) => void) | null = null
  private currentResolve: ((coords: number[][]) => void) | null = null
  private onMessage: ((e: MessageEvent) => void) | null = null

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./embedding-projection-worker.ts', import.meta.url), {
        type: 'module',
      })
    }
    return this.worker
  }

  start(
    items: EmbeddingSnapshotItem[],
    onProgress: (epoch: number, totalEpochs: number) => void,
    signal: { cancelled: boolean },
    resolve: (coords: number[][]) => void,
    reject: (err: Error) => void,
  ): void {
    // Hard-stop any previous run before starting a new one.
    this.cancelInternal()

    this.currentResolve = resolve
    this.currentReject = reject

    const w = this.ensureWorker()
    this.onMessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'progress') {
        onProgress(msg.epoch, msg.totalEpochs)
        return
      }
      if (msg.type === 'done') {
        this.detach()
        this.currentResolve = null
        this.currentReject = null
        resolve(msg.coords as number[][])
        return
      }
      if (msg.type === 'error') {
        this.detach()
        this.currentResolve = null
        this.currentReject = null
        reject(new Error(msg.message as string))
      }
    }
    w.addEventListener('message', this.onMessage)
    w.postMessage({ type: 'project', items })

    // If a cancel arrived before the worker responded, stop now.
    if (signal.cancelled) {
      this.cancelInternal()
    }
  }

  cancel(): void {
    this.cancelInternal()
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.detach()
    if (this.currentReject) {
      this.currentReject(new Error('disposed'))
    }
    this.currentResolve = null
    this.currentReject = null
  }

  private cancelInternal(): void {
    if (this.worker && (this.currentResolve || this.currentReject)) {
      // Terminate hard-stops the in-flight UMAP immediately.
      this.worker.terminate()
      this.worker = null
      this.detach()
      if (this.currentReject) {
        this.currentReject(new Error(CANCELLED))
      }
      this.currentResolve = null
      this.currentReject = null
    }
  }

  private detach(): void {
    if (this.onMessage && this.worker) {
      this.worker.removeEventListener('message', this.onMessage)
    }
    this.onMessage = null
  }
}

function notify() {
  for (const listener of listeners) listener(phase)
}

function setPhase(next: EmbeddingProjectionPhase) {
  phase = next
  notify()
}

async function fetchWithRetry(url: string, retries = MAX_FETCH_RETRIES): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url)
    } catch (err) {
      lastErr = err
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      }
    }
  }
  throw lastErr
}

async function fetchEmbeddingRevision(): Promise<string> {
  const res = await fetchWithRetry('/api/embeddings/revision')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Server returned ${res.status}: ${text || 'unknown error'}`)
  }
  const body = (await res.json()) as EmbeddingRevisionResponse
  return body.revision
}

async function fetchEmbeddingSnapshot(): Promise<EmbeddingSnapshotResponse> {
  const res = await fetchWithRetry('/api/embeddings/snapshot')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Server returned ${res.status}: ${text || 'unknown error'}`)
  }
  return (await res.json()) as EmbeddingSnapshotResponse
}

async function fetchServerProjectedCoords(revision: string): Promise<number[][] | null> {
  try {
    const res = await fetchWithRetry('/api/embeddings/project')
    if (!res.ok) return null
    const body = (await res.json()) as ProjectedEmbeddingResponse
    if (body.revision !== revision) return null
    return body.coords
  } catch {
    return null
  }
}

function applyCache(revision: string, items: EmbeddingSnapshotItem[], coords: number[][]) {
  cachedRevision = revision
  cachedItems = items
  cachedCoords = coords
  setPhase({ kind: 'ready', revision, items, coords })
}

/** Run client-side UMAP in a worker; resolves with projected coords. Rejects on cancel. */
function runClientProjection(
  items: EmbeddingSnapshotItem[],
  generation: number,
): Promise<number[][]> {
  return new Promise<number[][]>((resolve, reject) => {
    const signal = { cancelled: false }
    const p = getProjector()
    p.start(
      items,
      (epoch, totalEpochs) => {
        if (generation !== runGeneration || signal.cancelled) {
          signal.cancelled = true
          p.cancel()
          return
        }
        setPhase({ kind: 'projecting', epoch, totalEpochs })
      },
      signal,
      resolve,
      reject,
    )
  })
}

async function runProjectionPipeline(): Promise<void> {
  const generation = runGeneration
  try {
    if (cachedRevision) {
      const revision = await fetchEmbeddingRevision()
      if (generation !== runGeneration) return
      if (revision === cachedRevision) {
        setPhase({ kind: 'ready', revision, items: cachedItems, coords: cachedCoords })
        return
      }
    }

    setPhase({ kind: 'loading' })
    const snapshot = await fetchEmbeddingSnapshot()
    if (generation !== runGeneration) return

    if (snapshot.items.length === 0) {
      applyCache(snapshot.revision, [], [])
      return
    }

    /** Try server-side projection first (faster, no client CPU cost) */
    setPhase({ kind: 'loading' })
    const serverCoords = await fetchServerProjectedCoords(snapshot.revision)
    if (generation !== runGeneration) return

    if (serverCoords && serverCoords.length === snapshot.items.length) {
      applyCache(snapshot.revision, snapshot.items, serverCoords)
      return
    }

    /** Fall back to client-side UMAP in a worker (main thread stays responsive). */
    const coords = await runClientProjection(snapshot.items, generation)
    if (generation !== runGeneration) return
    applyCache(snapshot.revision, snapshot.items, coords)
  } catch (err) {
    if (generation !== runGeneration) return
    if (err instanceof Error && err.message === CANCELLED) {
      // Cancelled by invalidate/navigate — phase already reset by the cancel path.
      return
    }
    setPhase({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Drop cached projection and hard-stop any in-flight worker run. */
export function invalidateEmbeddingProjection(): void {
  runGeneration++
  cachedRevision = null
  cachedItems = []
  cachedCoords = []
  inFlight = null
  projector?.cancel()
  if (phase.kind !== 'idle') {
    setPhase({ kind: 'idle' })
  }
}

/** Subscribe to projection phase updates (returns current phase immediately). */
export function subscribeEmbeddingProjection(listener: Listener): () => void {
  listeners.add(listener)
  listener(phase)
  return () => listeners.delete(listener)
}

export function getEmbeddingProjectionPhase(): EmbeddingProjectionPhase {
  return phase
}

/**
 * Prefetch embedding projection when entering the Memory hub.
 * Skips UMAP when server revision matches the cached result.
 */
export function ensureEmbeddingProjection(force = false): Promise<void> {
  if (force) {
    invalidateEmbeddingProjection()
  }
  if (inFlight && !force) return inFlight

  inFlight = runProjectionPipeline().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Stop the worker and drop all projection state (called when leaving the Memory hub). */
export function disposeEmbeddingProjection(): void {
  invalidateEmbeddingProjection()
  projector?.dispose()
  projector = null
}
