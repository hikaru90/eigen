import { describe, expect, it, vi } from 'vitest'
import { load } from './+page.server'

const { fetchSnapshotMock, fetchCommunitiesMock } = vi.hoisted(() => ({
  fetchSnapshotMock: vi.fn(),
  fetchCommunitiesMock: vi.fn(),
}))

const { loadAuthorLayerGraphDataMock } = vi.hoisted(() => ({
  loadAuthorLayerGraphDataMock: vi.fn(),
}))

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  fetchGraphVisualizationSnapshot: fetchSnapshotMock,
}))

vi.mock('$lib/server/graph/community-overlays', () => ({
  fetchGraphCommunityOverlays: fetchCommunitiesMock,
}))

vi.mock('$lib/server/graph/author-layers', () => ({
  loadAuthorLayerGraphData: loadAuthorLayerGraphDataMock,
}))

vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: vi.fn().mockResolvedValue(undefined),
  loadOntologyForUser: vi.fn().mockResolvedValue({
    entityKinds: [],
    relationKinds: [],
    entityKindsById: new Map(),
    entityKindsByKey: new Map(),
    relationKindsById: new Map(),
    relationKindsByKey: new Map(),
  }),
}))

describe('memory page server', () => {
  it('redirects unauthenticated user', async () => {
    await expect(
      load({ locals: { user: null }, url: new URL('http://localhost/memory') } as never),
    ).rejects.toMatchObject({ status: 302 })
  })

  it('returns snapshot for signed-in user', async () => {
    getDbMock.mockReturnValue({})
    fetchSnapshotMock.mockResolvedValueOnce({
      nodes: [{ id: 'e1', kind: 'Entity', label: 'Sam', subtype: 'person' }],
      edges: [],
    })
    fetchCommunitiesMock.mockResolvedValueOnce([])
    loadAuthorLayerGraphDataMock.mockResolvedValueOnce({
      authorLayers: [{ key: 'user', label: 'You', kind: 'user' }],
      entityAuthorLayerKeys: { e1: ['user'] },
      coMentionEdgeLayerKeys: {},
    })
    const data = await load({
      locals: {
        user: { id: 'u1', email: 'a@b.c' },
      },
      url: new URL('http://localhost/memory'),
    } as never)
    expect(data).toBeTruthy()
    if (!data) return
    expect(data.snapshot.nodes[0]?.authorLayerKeys).toEqual(['user'])
    expect(data.authorLayers).toEqual([{ key: 'user', label: 'You', kind: 'user' }])
    expect(data.communities).toEqual([])
    expect(Array.isArray(data.graphLegendSections)).toBe(true)
    expect(fetchSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', nodeLimit: 500, edgeLimit: 1200 }),
    )
  })
})
