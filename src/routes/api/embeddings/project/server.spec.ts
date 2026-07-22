import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET } from './+server'

const {
  getDbMock,
  loadEmbeddingSnapshotRowsMock,
  assertValidEmbeddingSnapshotRowsMock,
  computeEmbeddingSnapshotRevisionMock,
  embeddingSnapshotMetaFromRowsMock,
  canRunUmapMock,
  centerAndScaleCoords3dMock,
  computeUmapNeighborsMock,
  fallbackProjection3dMock,
  l2NormalizeEmbeddingsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(() => ({})),
  loadEmbeddingSnapshotRowsMock: vi.fn(),
  assertValidEmbeddingSnapshotRowsMock: vi.fn(),
  computeEmbeddingSnapshotRevisionMock: vi.fn(() => 'rev-hash'),
  embeddingSnapshotMetaFromRowsMock: vi.fn((rows: unknown[]) => rows),
  canRunUmapMock: vi.fn(() => false),
  centerAndScaleCoords3dMock: vi.fn((coords: number[][]) => coords),
  computeUmapNeighborsMock: vi.fn(() => 2),
  fallbackProjection3dMock: vi.fn((n: number) => Array.from({ length: n }, () => [0, 0, 0])),
  l2NormalizeEmbeddingsMock: vi.fn((items: { embedding: number[] }[]) =>
    items.map((i) => i.embedding),
  ),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/embeddings/embedding-snapshot', () => ({
  assertValidEmbeddingSnapshotRows: assertValidEmbeddingSnapshotRowsMock,
  computeEmbeddingSnapshotRevision: computeEmbeddingSnapshotRevisionMock,
  embeddingSnapshotMetaFromRows: embeddingSnapshotMetaFromRowsMock,
  loadEmbeddingSnapshotRows: loadEmbeddingSnapshotRowsMock,
}))

vi.mock('$lib/server/embeddings/embedding-projection', () => ({
  canRunUmap: canRunUmapMock,
  centerAndScaleCoords3d: centerAndScaleCoords3dMock,
  computeUmapNeighbors: computeUmapNeighborsMock,
  fallbackProjection3d: fallbackProjection3dMock,
  l2NormalizeEmbeddings: l2NormalizeEmbeddingsMock,
}))

function event(user: { id: string } | null = { id: 'u1' }) {
  return { locals: { user } } as Parameters<typeof GET>[0]
}

describe('GET /api/embeddings/project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    computeEmbeddingSnapshotRevisionMock.mockReturnValue('rev-hash')
    embeddingSnapshotMetaFromRowsMock.mockImplementation((rows: unknown[]) => rows)
    canRunUmapMock.mockReturnValue(false)
    centerAndScaleCoords3dMock.mockImplementation((coords: number[][]) => coords)
    computeUmapNeighborsMock.mockReturnValue(2)
    fallbackProjection3dMock.mockImplementation((n: number) =>
      Array.from({ length: n }, () => [0, 0, 0]),
    )
    l2NormalizeEmbeddingsMock.mockImplementation((items: { embedding: number[] }[]) =>
      items.map((i) => i.embedding),
    )
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(GET(event(null))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 500 when snapshot rows fail validation', async () => {
    loadEmbeddingSnapshotRowsMock.mockResolvedValue([{ id: 'bad' }])
    assertValidEmbeddingSnapshotRowsMock.mockImplementation(() => {
      throw new Error('invalid embedding length')
    })
    await expect(GET(event())).rejects.toMatchObject({ status: 500 })
  })

  it('returns an empty fallback projection when there are no items', async () => {
    loadEmbeddingSnapshotRowsMock.mockResolvedValue([])
    assertValidEmbeddingSnapshotRowsMock.mockImplementation(() => undefined)

    const res = await GET(event())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revision: 'rev-hash', coords: [], method: 'fallback' })
  })

  it('uses the fallback projection when UMAP cannot run', async () => {
    loadEmbeddingSnapshotRowsMock.mockResolvedValue([
      { embedding: [0.1, 0.2] },
      { embedding: [0.3, 0.4] },
    ])
    assertValidEmbeddingSnapshotRowsMock.mockImplementation(() => undefined)
    canRunUmapMock.mockReturnValue(false)

    const res = await GET(event())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.method).toBe('fallback')
    expect(body.coords).toHaveLength(2)
  })
})
