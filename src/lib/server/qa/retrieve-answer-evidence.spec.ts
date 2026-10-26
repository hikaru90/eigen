import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withEvalRelevanceFloor } from '$lib/server/retrieval/relevance-floor'

const { searchThoughtsMock, searchTextFilesMock } = vi.hoisted(() => ({
  searchThoughtsMock: vi.fn(),
  searchTextFilesMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/service', () => ({ searchThoughts: searchThoughtsMock }))
vi.mock('$lib/server/text-files/service', () => ({ searchTextFiles: searchTextFilesMock }))

import { retrieveAnswerEvidence } from './retrieve-answer-evidence'

const EMBEDDING = [0.1, 0.2]

function thoughtHit(id: string, score: number) {
  return {
    id,
    normalizedText: `thought ${id}`,
    category: 'observation',
    author: 'user' as const,
    authorLabel: null,
    score,
    vectorScore: score,
    graphScore: 0,
    metadata: {},
    createdAt: new Date('2026-06-01T00:00:00Z'),
  }
}

function noteHit(id: string, score: number) {
  return {
    id,
    title: `note ${id}`,
    preview: 'p',
    excerpt: `excerpt ${id}`,
    matchedOrdinals: [0],
    score,
    vectorScore: score,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    author: 'user' as const,
    authorLabel: null,
    authorKeyId: null,
  }
}

const base = {
  userId: 'u1',
  query: 'surfing',
  queryEmbedding: EMBEDDING,
  topK: 8,
  noteTopK: 5,
}

beforeEach(() => {
  vi.clearAllMocks()
  searchThoughtsMock.mockResolvedValue([])
  searchTextFilesMock.mockResolvedValue([])
})

describe('retrieveAnswerEvidence (the retrieval half of composeAnswer, shared with forget)', () => {
  it('searches thoughts and notes once each with the caller embedding and the product floor', async () => {
    const intent = { temporal: false } as never
    await retrieveAnswerEvidence({
      ...base,
      weights: { vector: 0.7, graph: 0.3 },
      temporalIntent: intent,
      authorFilter: 'user',
    })

    expect(searchThoughtsMock).toHaveBeenCalledTimes(1)
    expect(searchThoughtsMock).toHaveBeenCalledWith({
      userId: 'u1',
      query: 'surfing',
      topK: 8,
      weights: { vector: 0.7, graph: 0.3 },
      queryEmbedding: EMBEDDING,
      temporalIntent: intent,
      authorFilter: 'user',
      extrasOut: expect.any(Object),
    })
    expect(searchThoughtsMock.mock.calls[0]![0]).not.toHaveProperty('expansions')
    expect(searchTextFilesMock).toHaveBeenCalledTimes(1)
    expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
      query: 'surfing',
      topK: 5,
      queryEmbedding: EMBEDDING,
      minScore: 0.22,
      onBelowFloor: expect.any(Function),
    })
  })

  it('thoughts below the relevance floor are dropped, and the best dropped score is reported', async () => {
    searchThoughtsMock.mockResolvedValue([thoughtHit('a', 0.9), thoughtHit('b', 0.1)])
    searchTextFilesMock.mockImplementation(
      async (_u: string, input: { onBelowFloor?: (best: number | null) => void }) => {
        input.onBelowFloor?.(0.15)
        return []
      },
    )

    const out = await retrieveAnswerEvidence(base)

    expect(out.retrieved.map((h) => h.id)).toEqual(['a'])
    expect(out.relevanceFloor).toBe(0.22)
    expect(out.belowFloor.thoughts).toBeCloseTo(0.1, 5)
    expect(out.belowFloor.notePassages).toBe(0.15)
  })

  it('honours the eval floor override for both thoughts and notes (harness users only)', async () => {
    const harnessUser = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
    searchThoughtsMock.mockResolvedValue([thoughtHit('a', 0.15)])
    const out = await withEvalRelevanceFloor(0.1, () =>
      retrieveAnswerEvidence({ ...base, userId: harnessUser }),
    )
    expect(out.retrieved.map((h) => h.id)).toEqual(['a'])
    expect(searchTextFilesMock).toHaveBeenCalledWith(
      harnessUser,
      expect.objectContaining({ minScore: 0.1 }),
    )
    // any other user: the override refuses, never silently falls back to the product floor
    await expect(
      withEvalRelevanceFloor(0.1, () => retrieveAnswerEvidence({ ...base, userId: 'u1' })),
    ).rejects.toThrow(/harness billing users/)
  })

  it('expansions run the thought channels once (merged inside) and one extra note search each; notes fuse inside the budget', async () => {
    const expansions = [
      { query: 'q1', embedding: [1] },
      { query: 'q2', embedding: [2] },
    ]
    searchTextFilesMock
      .mockResolvedValueOnce([noteHit('n1', 0.9), noteHit('n2', 0.8)])
      .mockResolvedValueOnce([noteHit('n3', 0.7), noteHit('n2', 0.6)])
      .mockResolvedValueOnce([noteHit('n4', 0.5)])

    const out = await retrieveAnswerEvidence({ ...base, noteTopK: 3, expansions })

    expect(searchThoughtsMock).toHaveBeenCalledTimes(1)
    expect(searchThoughtsMock.mock.calls[0]![0].expansions).toEqual(expansions)
    expect(searchTextFilesMock).toHaveBeenCalledTimes(3)
    expect(searchTextFilesMock.mock.calls.map(([, arg]) => arg.query)).toEqual(['surfing', 'q1', 'q2'])
    expect(out.noteHits.length).toBeLessThanOrEqual(3)
    expect(new Set(out.noteHits.map((n) => n.id)).size).toBe(out.noteHits.length)
  })

  it('without expansions the note hits are the query note hits untouched', async () => {
    const notes = [noteHit('n1', 0.9), noteHit('n2', 0.8)]
    searchTextFilesMock.mockResolvedValue(notes)
    const out = await retrieveAnswerEvidence(base)
    expect(out.noteHits).toBe(notes)
  })

  it('hands back the extras that searchThoughts filled (community themes, temporal seeds)', async () => {
    searchThoughtsMock.mockImplementation(async (input: { extrasOut: Record<string, unknown> }) => {
      input.extrasOut.communityThemes = [{ communityId: 'c', level: 1, summaryText: 's' }]
      input.extrasOut.temporalSeeds = [{ thoughtId: 't' }]
      return []
    })
    const out = await retrieveAnswerEvidence(base)
    expect(out.extras.communityThemes).toHaveLength(1)
    expect(out.extras.temporalSeeds).toHaveLength(1)
  })
})
