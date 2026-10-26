import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPANSION_CANDIDATES_PER_QUERY, fetchExpansionCandidates } from './expansion-candidates'

const { fetchThoughtAnnMock, lexicalSearchMock } = vi.hoisted(() => ({
  fetchThoughtAnnMock: vi.fn(),
  lexicalSearchMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/thought-ann', () => ({
  THOUGHT_ANN_LIMIT: 30,
  fetchThoughtAnn: fetchThoughtAnnMock,
}))
vi.mock('$lib/server/retrieval/lexical', () => ({ lexicalSearch: lexicalSearchMock }))

describe('fetchExpansionCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchThoughtAnnMock.mockResolvedValue([])
    lexicalSearchMock.mockResolvedValue([])
  })

  it('fuses vector and lexical rankings, carrying both scores for a doubly-found id', async () => {
    fetchThoughtAnnMock.mockResolvedValue([
      { id: 'a', distance: 0.2 },
      { id: 'b', distance: 0.4 },
    ])
    lexicalSearchMock.mockResolvedValue([
      { id: 'b', lexicalScore: 0.3 },
      { id: 'c', lexicalScore: 0.1 },
    ])

    const out = await fetchExpansionCandidates({
      userId: 'u1',
      query: 'foods the user avoids',
      queryEmbedding: [0.1],
    })

    expect(out.map((c) => c.id)).toEqual(['b', 'a', 'c'])
    expect(out[0]).toEqual({ id: 'b', vectorDistance: 0.4, lexicalScore: 0.3 })
    expect(out[1]).toEqual({ id: 'a', vectorDistance: 0.2 })
    expect(lexicalSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', query: 'foods the user avoids' }),
    )
  })

  it('caps one sub-query at its per-query budget', async () => {
    fetchThoughtAnnMock.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, distance: i / 100 })),
    )
    const out = await fetchExpansionCandidates({
      userId: 'u1',
      query: 'q',
      queryEmbedding: [0.1],
    })
    expect(out).toHaveLength(EXPANSION_CANDIDATES_PER_QUERY)
  })
})
