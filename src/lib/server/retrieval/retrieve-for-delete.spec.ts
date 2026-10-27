import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mergeRetrievalResultsByBestScore } from './retrieve-for-delete'

const { deriveDeleteSearchQueriesMock, searchThoughtsMock } = vi.hoisted(() => ({
  deriveDeleteSearchQueriesMock: vi.fn(),
  searchThoughtsMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/derive-delete-search-query', () => ({
  deriveDeleteSearchQueries: deriveDeleteSearchQueriesMock,
}))
vi.mock('$lib/server/retrieval/service', () => ({
  searchThoughts: searchThoughtsMock,
}))

import { retrieveThoughtRowsForDeleteRequest } from './retrieve-for-delete'

describe('mergeRetrievalResultsByBestScore', () => {
  it('keeps the highest score per thought id', () => {
    const merged = mergeRetrievalResultsByBestScore([
      [
        {
          id: 't1',
          normalizedText: 'Shakshuka',
          category: 'reference',
          score: 0.4,
          vectorScore: 0.4,
          graphScore: 0,
          metadata: {},
          createdAt: new Date(),
        },
      ],
      [
        {
          id: 't1',
          normalizedText: 'Shakshuka',
          category: 'reference',
          score: 0.9,
          vectorScore: 0.9,
          graphScore: 0,
          metadata: {},
          createdAt: new Date(),
        },
        {
          id: 't2',
          normalizedText: 'Caesar salad',
          category: 'reference',
          score: 0.8,
          vectorScore: 0.8,
          graphScore: 0,
          metadata: {},
          createdAt: new Date(),
        },
      ],
    ])

    expect(merged.map((r) => r.id)).toEqual(['t1', 't2'])
    expect(merged[0].score).toBe(0.9)
  })
})

describe('retrieveThoughtRowsForDeleteRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs semantic search for each derived query and merges results', async () => {
    deriveDeleteSearchQueriesMock.mockResolvedValue(['recipes cooking', 'shakshuka salad soup'])
    searchThoughtsMock
      .mockResolvedValueOnce([
        {
          id: 't-shak',
          normalizedText: 'Shakshuka with eggs',
          category: 'reference',
          score: 0.7,
          vectorScore: 0.7,
          graphScore: 0,
          metadata: {},
          createdAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 't-salad',
          normalizedText: 'Classic Caesar Salad',
          category: 'reference',
          score: 0.75,
          vectorScore: 0.75,
          graphScore: 0,
          metadata: {},
          createdAt: new Date(),
        },
      ])

    const out = await retrieveThoughtRowsForDeleteRequest({
      userId: 'u1',
      deleteRequest: 'delete all recipes',
    })

    expect(deriveDeleteSearchQueriesMock).toHaveBeenCalledWith({
      userId: 'u1',
      deleteRequest: 'delete all recipes',
    })
    expect(searchThoughtsMock).toHaveBeenCalledTimes(2)
    expect(out.queries).toEqual(['recipes cooking', 'shakshuka salad soup'])
    expect(out.results.map((r) => r.id)).toEqual(['t-salad', 't-shak'])
  })
  it('createdBefore keeps only thoughts captured strictly before the cutoff (a fact restated later stays)', async () => {
    deriveDeleteSearchQueriesMock.mockResolvedValue(['surfing'])
    const row = (id: string, createdAt: string, score: number) => ({
      id,
      normalizedText: id,
      category: 'observation',
      score,
      vectorScore: score,
      graphScore: 0,
      metadata: {},
      createdAt: new Date(createdAt),
    })
    searchThoughtsMock.mockResolvedValueOnce([
      row('earlier', '2026-06-01T00:00:00.000Z', 0.9),
      row('same-instant', '2026-06-02T10:00:00.000Z', 0.95),
      row('later-restatement', '2026-06-03T00:00:00.000Z', 0.99),
    ])

    const out = await retrieveThoughtRowsForDeleteRequest({
      userId: 'u1',
      deleteRequest: 'forget surfing',
      createdBefore: new Date('2026-06-02T10:00:00.000Z'),
    })

    expect(out.results.map((r) => r.id)).toEqual(['earlier'])
  })

  it('without createdBefore nothing is filtered by time', async () => {
    deriveDeleteSearchQueriesMock.mockResolvedValue(['q'])
    searchThoughtsMock.mockResolvedValueOnce([
      {
        id: 'x',
        normalizedText: 'x',
        category: 'c',
        score: 0.5,
        vectorScore: 0.5,
        graphScore: 0,
        metadata: {},
        createdAt: new Date('2030-01-01'),
      },
    ])
    const out = await retrieveThoughtRowsForDeleteRequest({ userId: 'u1', deleteRequest: 'd' })
    expect(out.results.map((r) => r.id)).toEqual(['x'])
  })
})
