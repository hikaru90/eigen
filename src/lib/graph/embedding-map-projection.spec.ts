import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureEmbeddingProjection,
  getEmbeddingProjectionPhase,
  invalidateEmbeddingProjection,
} from './embedding-map-projection'

vi.mock('umap-js', () => ({
  UMAP: class {
    constructor() {}
    async fitAsync(_embeddings: number[][], onEpoch: (epoch: number) => boolean) {
      onEpoch(1)
      return _embeddings.map((_, i) => [i, i, i])
    }
  },
}))

function makeItem(id: string) {
  return {
    id,
    kind: 'Thought' as const,
    label: id,
    subtype: 'observation',
    embedding: Array.from({ length: 1536 }, (_, i) => i * 0.001),
  }
}

function mockEmbeddingFetch(handlers: {
  revision?: string | (() => string)
  snapshot?:
    | { revision: string; items: ReturnType<typeof makeItem>[] }
    | (() => {
        revision: string
        items: ReturnType<typeof makeItem>[]
      })
  project?:
    | { revision: string; coords: number[][]; method: 'umap' | 'fallback' }
    | (() => { revision: string; coords: number[][]; method: 'umap' | 'fallback' })
    | null
}) {
  const fetchMock = vi.mocked(fetch)
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/embeddings/revision')) {
      const revision =
        typeof handlers.revision === 'function' ? handlers.revision() : handlers.revision
      if (revision === undefined) throw new Error('unexpected revision fetch')
      return new Response(JSON.stringify({ revision }), { status: 200 })
    }
    if (url.includes('/api/embeddings/project')) {
      if (handlers.project === null) {
        return new Response('unavailable', { status: 503 })
      }
      const body = typeof handlers.project === 'function' ? handlers.project() : handlers.project
      if (!body) throw new Error('unexpected project fetch')
      return new Response(JSON.stringify(body), { status: 200 })
    }
    if (url.includes('/api/embeddings/snapshot')) {
      const body = typeof handlers.snapshot === 'function' ? handlers.snapshot() : handlers.snapshot
      if (!body) throw new Error('unexpected snapshot fetch')
      return new Response(JSON.stringify(body), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  return fetchMock
}

describe('embedding-map-projection', () => {
  beforeEach(() => {
    invalidateEmbeddingProjection()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    invalidateEmbeddingProjection()
    vi.unstubAllGlobals()
  })

  it('reuses cached projection when revision is unchanged', async () => {
    const revision = 'rev-1'
    const items = [makeItem('t1')]
    const fetchMock = mockEmbeddingFetch({
      revision,
      snapshot: { revision, items },
      project: {
        revision,
        coords: [[0, 0, 0]],
        method: 'fallback',
      },
    })

    await ensureEmbeddingProjection()
    expect(getEmbeddingProjectionPhase().kind).toBe('ready')
    // Cold start: snapshot + server project
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await ensureEmbeddingProjection()
    // Cache hit: revision check only
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/embeddings/revision')
    expect(getEmbeddingProjectionPhase().kind).toBe('ready')
  })

  it('refetches and reprojects after forced refresh', async () => {
    const revisionA = 'rev-a'
    const revisionB = 'rev-b'
    const itemsA = [makeItem('t1')]
    const itemsB = [makeItem('t1'), makeItem('t2')]
    let snapshotRound = 0
    mockEmbeddingFetch({
      revision: () => (snapshotRound === 0 ? revisionA : revisionB),
      snapshot: () => {
        snapshotRound += 1
        return snapshotRound === 1
          ? { revision: revisionA, items: itemsA }
          : { revision: revisionB, items: itemsB }
      },
      project: () =>
        snapshotRound === 1
          ? { revision: revisionA, coords: [[0, 0, 0]], method: 'fallback' }
          : {
              revision: revisionB,
              coords: [
                [0, 0, 0],
                [1, 1, 1],
              ],
              method: 'fallback',
            },
    })

    await ensureEmbeddingProjection()
    await ensureEmbeddingProjection(true)

    const phase = getEmbeddingProjectionPhase()
    expect(phase.kind).toBe('ready')
    if (phase.kind === 'ready') {
      expect(phase.items).toHaveLength(2)
    }
  })
})
