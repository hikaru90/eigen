import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ENTITY_ENRICHMENT_GRAPH_ENTITY_CAP,
  ENTITY_ENRICHMENT_LIMIT_PER_SOURCE,
  formatKnownGraphEntitiesPromptBlock,
  graphEntityIdByLabel,
  loadEntityGraphEnrichmentContext,
} from './entity-graph-enrichment-context'

const { fetchEntityEdgesForUserMock, matchCanonicalEntitiesByEmbeddingMock } = vi.hoisted(() => ({
  fetchEntityEdgesForUserMock: vi.fn(),
  matchCanonicalEntitiesByEmbeddingMock: vi.fn(),
}))

vi.mock('$lib/server/graph/age', () => ({
  fetchEntityEdgesForUser: fetchEntityEdgesForUserMock,
}))

vi.mock('$lib/server/memory/entity-resolution', () => ({
  matchCanonicalEntitiesByEmbedding: matchCanonicalEntitiesByEmbeddingMock,
}))

const { getDbMock, selectMock, limitMock } = vi.hoisted(() => {
  const limitMock = vi.fn()
  const whereMock = vi.fn(() => ({ limit: limitMock }))
  const fromMock = vi.fn(() => ({ where: whereMock }))
  const selectMock = vi.fn(() => ({ from: fromMock }))
  return { getDbMock: vi.fn(), selectMock, limitMock }
})

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

describe('formatKnownGraphEntitiesPromptBlock', () => {
  it('includes entity UUIDs and states they are already in graph', () => {
    const block = formatKnownGraphEntitiesPromptBlock([
      {
        entityId: 'picnic-id',
        label: 'picnic',
        entityType: 'event',
        source: 'lexical',
      },
    ])
    expect(block).toContain('id=picnic-id')
    expect(block).toContain('already persisted')
  })
})

describe('graphEntityIdByLabel', () => {
  it('maps label and lexical key to entity id', () => {
    const map = graphEntityIdByLabel([
      { entityId: 'hub-1', label: 'picnic', entityType: 'event', source: 'lexical' },
    ])
    expect(map.get('picnic')).toBe('hub-1')
  })
})

describe('loadEntityGraphEnrichmentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({ select: selectMock })
    fetchEntityEdgesForUserMock.mockResolvedValue([])
    matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([])
  })

  it('caps lexical hints per source and includes entity ids', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      id: `id-${i}`,
      label: `picnic item ${i}`,
      entityType: 'concept',
    }))
    limitMock.mockResolvedValue(rows)

    const ctx = await loadEntityGraphEnrichmentContext({
      userId: 'u1',
      normalizedText: 'picnic item 0 and picnic item 1 for picnic',
      communityExcerpts: [],
      groundingProfile: null,
    })

    expect(ctx.graphEntities.length).toBeLessThanOrEqual(ENTITY_ENRICHMENT_LIMIT_PER_SOURCE)
    for (const entity of ctx.graphEntities) {
      expect(entity.entityId).toBeTruthy()
    }
  })

  it('merges embedding neighbors under graph entity cap', async () => {
    limitMock.mockResolvedValue([])
    matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `emb-${i}`,
        label: `theme-${i}`,
        entityType: 'concept',
        distance: 0.1,
      })),
    )

    const ctx = await loadEntityGraphEnrichmentContext({
      userId: 'u1',
      normalizedText: 'bring fish',
      thoughtEmbedding: [0.1, 0.2],
      communityExcerpts: [{ communityId: 'c1', level: 1, summaryText: 'Outdoor meals' }],
      groundingProfile: null,
    })

    expect(ctx.graphEntities.length).toBeLessThanOrEqual(ENTITY_ENRICHMENT_GRAPH_ENTITY_CAP)
    expect(ctx.communityExcerpts).toHaveLength(1)
  })
})
