import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withEvalRelevanceFloor } from '$lib/server/retrieval/relevance-floor'

const {
  searchThoughtsMock,
  searchTextFilesMock,
  searchUserFactsMock,
  runEnforcedPerItemDecisionsMock,
  llmChatCompletionMock,
} = vi.hoisted(() => ({
  searchThoughtsMock: vi.fn(),
  searchTextFilesMock: vi.fn(),
  searchUserFactsMock: vi.fn(),
  runEnforcedPerItemDecisionsMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/service', () => ({ searchThoughts: searchThoughtsMock }))
vi.mock('$lib/server/text-files/service', () => ({ searchTextFiles: searchTextFilesMock }))
vi.mock('$lib/server/facts/search-user-facts', () => ({ searchUserFacts: searchUserFactsMock }))
// What the answer sees is judged by Jev (evidence_relevance) through the plane, never by a chat call.
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedPerItemDecisions: runEnforcedPerItemDecisionsMock }
})
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import {
  FACT_ANSWER_MAX,
  retrieveAnswerEvidence,
  selectRelevantEvidence,
  type AnswerEvidence,
} from './retrieve-answer-evidence'

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

function factHit(id: string, score: number, over: Record<string, unknown> = {}) {
  return {
    id,
    subjectKind: 'user' as const,
    subjectLabel: null,
    subjectEntityId: null,
    statement: `statement of ${id}`,
    kind: 'activity' as const,
    inferred: false,
    confidence: 0.9,
    status: 'active' as const,
    supersededBy: null,
    asOf: new Date('2026-05-01T00:00:00Z'),
    secureValueId: null,
    sourceThoughtIds: [],
    sourceTextFileIds: [],
    score,
    vectorScore: score,
    ...over,
  }
}

const base = {
  userId: 'u1',
  query: 'surfing',
  queryEmbedding: EMBEDDING,
  topK: 8,
  noteTopK: 5,
  factTopK: 8,
}

beforeEach(() => {
  vi.clearAllMocks()
  searchThoughtsMock.mockResolvedValue([])
  searchTextFilesMock.mockResolvedValue([])
  searchUserFactsMock.mockResolvedValue([])
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

describe('retrieveAnswerEvidence: user facts (docs/planning/user-facts-layer.md, F2)', () => {
  it('searches the active facts once for the question: caller embedding, product floor, their own top-K', async () => {
    await retrieveAnswerEvidence(base)

    expect(searchUserFactsMock).toHaveBeenCalledTimes(1)
    expect(searchUserFactsMock).toHaveBeenCalledWith('u1', {
      query: 'surfing',
      queryEmbedding: EMBEDDING,
      topK: 8,
      minScore: 0.22,
    })
  })

  it('returns the fact hits as searched and leaves the thought and note budgets alone', async () => {
    const facts = [factHit('f1', 0.9), factHit('f2', 0.5)]
    searchUserFactsMock.mockResolvedValue(facts)
    searchThoughtsMock.mockResolvedValue([thoughtHit('a', 0.9)])
    searchTextFilesMock.mockResolvedValue([noteHit('n1', 0.9)])

    const out = await retrieveAnswerEvidence({ ...base, topK: 3, noteTopK: 2, factTopK: 2 })

    expect(out.facts.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(out.retrieved.map((h) => h.id)).toEqual(['a'])
    expect(out.noteHits).toHaveLength(1)
    expect(searchThoughtsMock.mock.calls[0]![0].topK).toBe(3)
    expect(searchUserFactsMock.mock.calls[0]![1].topK).toBe(2)
  })

  it('keeps an identifier fact as its reference: the hit never holds a value', async () => {
    const ref = '[secure:22222222-2222-4222-8222-222222222222]'
    searchUserFactsMock.mockResolvedValue([
      factHit('f1', 0.9, { statement: `The user's licence plate is ${ref}`, kind: 'circumstance' }),
    ])
    const out = await retrieveAnswerEvidence(base)
    expect(out.facts[0]!.statement).toContain(ref)
  })

  it('honours the eval floor override for facts too (harness users only)', async () => {
    const harnessUser = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
    await withEvalRelevanceFloor(0.1, () => retrieveAnswerEvidence({ ...base, userId: harnessUser }))
    expect(searchUserFactsMock).toHaveBeenCalledWith(
      harnessUser,
      expect.objectContaining({ minScore: 0.1 }),
    )
  })

  it('expansions: one fact search per sub-query with its own embedding, fused by reciprocal rank inside the facts budget', async () => {
    const expansions = [
      { query: 'q1', embedding: [1] },
      { query: 'q2', embedding: [2] },
    ]
    searchUserFactsMock
      .mockResolvedValueOnce([factHit('f1', 0.9), factHit('f2', 0.8)])
      .mockResolvedValueOnce([factHit('f3', 0.7), factHit('f2', 0.6)])
      .mockResolvedValueOnce([factHit('f3', 0.5), factHit('f4', 0.4)])

    const out = await retrieveAnswerEvidence({ ...base, factTopK: 3, expansions })

    expect(searchUserFactsMock).toHaveBeenCalledTimes(3)
    expect(
      searchUserFactsMock.mock.calls.map(([, arg]) => [arg.query, arg.queryEmbedding, arg.topK]),
    ).toEqual([
      ['surfing', EMBEDDING, 3],
      ['q1', [1], 3],
      ['q2', [2], 3],
    ])
    expect(out.facts).toHaveLength(3)
    expect(new Set(out.facts.map((f) => f.id)).size).toBe(3)
    expect(out.facts.map((f) => f.id)).toEqual(['f3', 'f2', 'f1'])
  })

  it('without expansions the fact hits are the question hits untouched', async () => {
    const facts = [factHit('f1', 0.9)]
    searchUserFactsMock.mockResolvedValue(facts)
    const out = await retrieveAnswerEvidence(base)
    expect(out.facts).toBe(facts)
  })

  it('the forget flow bounds facts to those known before its capture (asOfBefore)', async () => {
    const cutoff = new Date('2026-06-02T10:00:00.000Z')
    await retrieveAnswerEvidence({ ...base, factsAsOfBefore: cutoff })
    expect(searchUserFactsMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ asOfBefore: cutoff }),
    )
  })

  it('an agent-only search (author=agent) is not about the user: no fact search', async () => {
    const out = await retrieveAnswerEvidence({ ...base, authorFilter: 'agent' })
    expect(searchUserFactsMock).not.toHaveBeenCalled()
    expect(out.facts).toEqual([])
    await retrieveAnswerEvidence({ ...base, authorFilter: 'user' })
    expect(searchUserFactsMock).toHaveBeenCalledTimes(1)
  })

  it('a failing fact search fails the retrieval: no silent answer without facts', async () => {
    searchUserFactsMock.mockRejectedValue(new Error('fact search failed'))
    await expect(retrieveAnswerEvidence(base)).rejects.toThrow('fact search failed')
  })
})


describe('selectRelevantEvidence (evidence_relevance: what the answer sees is Jev-judged)', () => {
  type Verdicts = Record<string, [choice: 'relevant' | 'partly' | 'not', probabilities: Record<string, number>]>

  function jev(verdicts: Verdicts) {
    runEnforcedPerItemDecisionsMock.mockImplementation(
      async (input: { items: Array<{ ref: string }> }) =>
        new Map(
          input.items.map((item) => {
            const [choice, probabilities] = verdicts[item.ref] ?? [
              'relevant',
              { relevant: 0.5, partly: 0.3, not: 0.2 },
            ]
            return [
              item.ref,
              {
                choice,
                probability: probabilities[choice]!,
                alternatives: Object.fromEntries(
                  Object.entries(probabilities).filter(([k]) => k !== choice),
                ),
              },
            ]
          }),
        ),
    )
  }

  const budgets = { thoughts: 8, notes: 5, facts: FACT_ANSWER_MAX }

  function evidence(over: Partial<AnswerEvidence> = {}): AnswerEvidence {
    return {
      retrieved: [],
      noteHits: [],
      facts: [],
      extras: { communityThemes: [], temporalSeeds: [] },
      belowFloor: { thoughts: null, notePassages: null },
      relevanceFloor: 0.22,
      ...over,
    }
  }

  const select = (e: AnswerEvidence, over: { budgets?: typeof budgets; question?: string } = {}) =>
    selectRelevantEvidence({
      userId: 'u1',
      question: over.question ?? 'Any tips against eye strain?',
      evidence: e,
      budgets: over.budgets ?? budgets,
    })

  const calls = () =>
    runEnforcedPerItemDecisionsMock.mock.calls.map(
      (c) =>
        c[0] as {
          surface: string
          kind: string
          state: string
          items: Array<{ ref: string; instructions: string }>
        },
    )

  it('judges thoughts, note passages AND facts in ONE batched Jev call per question', async () => {
    jev({})
    await select(
      evidence({
        retrieved: [thoughtHit('a', 0.9), thoughtHit('b', 0.8)],
        noteHits: [noteHit('n1', 0.7)],
        facts: [factHit('f1', 0.6), factHit('f2', 0.5)],
      }),
    )

    expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
    const [call] = calls()
    expect(call!.surface).toBe('evidence')
    expect(call!.kind).toBe('evidence_relevance')
    // the user's question, not the retrieval query
    expect(call!.state).toBe('Question: Any tips against eye strain?')
    expect(call!.items.map((i) => i.ref)).toEqual(['t1', 't2', 'n1', 'f1', 'f2'])
    expect(call!.items[0]!.instructions).toContain('thought a')
    expect(call!.items[2]!.instructions).toContain('excerpt n1')
    expect(call!.items[2]!.instructions).toContain('note n1')
    expect(call!.items[3]!.instructions).toContain('statement of f1')
    expect(call!.items[3]!.instructions).toMatch(/the user \(activity, as of 2026-05-01\)/)
  })

  it('drops what Jev judged not relevant — thoughts, notes and facts alike — and orders the rest by relevance', async () => {
    jev({
      t1: ['partly', { partly: 0.6, relevant: 0.2, not: 0.2 }],
      t2: ['relevant', { relevant: 0.9, partly: 0.08, not: 0.02 }],
      t3: ['not', { not: 0.9, partly: 0.08, relevant: 0.02 }],
      n1: ['not', { not: 0.7, partly: 0.2, relevant: 0.1 }],
      n2: ['relevant', { relevant: 0.8, partly: 0.1, not: 0.1 }],
      f1: ['not', { not: 0.8, partly: 0.1, relevant: 0.1 }],
      f2: ['relevant', { relevant: 0.95, partly: 0.04, not: 0.01 }],
    })
    const out = await select(
      evidence({
        retrieved: [thoughtHit('a', 0.9), thoughtHit('b', 0.8), thoughtHit('c', 0.7)],
        noteHits: [noteHit('n1', 0.9), noteHit('n2', 0.8)],
        facts: [factHit('f1', 0.9), factHit('f2', 0.8)],
      }),
    )
    expect(out.retrieved.map((h) => h.id)).toEqual(['b', 'a'])
    expect(out.noteHits.map((h) => h.id)).toEqual(['n2'])
    expect(out.facts.map((f) => f.id)).toEqual(['f2'])
  })

  it(`facts get a small budget of what is judged relevant: at most ${FACT_ANSWER_MAX}, never a fixed 24`, async () => {
    const facts = Array.from({ length: 24 }, (_, i) => factHit(`f${i + 1}`, 0.9 - i / 100))
    // the 12 last candidates are the most relevant ones: relevance, not retrieval rank, decides
    jev(
      Object.fromEntries(
        facts.map((_, i): [string, Verdicts[string]] => [
          `f${i + 1}`,
          i >= 12
            ? ['relevant', { relevant: 0.99 - (i - 12) / 100, partly: 0.005, not: 0.005 }]
            : ['partly', { partly: 0.6, relevant: 0.2, not: 0.2 }],
        ]),
      ),
    )
    const out = await select(evidence({ facts }))
    expect(out.facts).toHaveLength(FACT_ANSWER_MAX)
    expect(out.facts.map((f) => f.id)).toEqual([
      'f13',
      'f14',
      'f15',
      'f16',
      'f17',
      'f18',
      'f19',
      'f20',
    ])
    // all 24 candidates went to Jev in the one call
    expect(calls()[0]!.items).toHaveLength(24)
  })

  it('irrelevant facts are dropped entirely: a question none of the facts help with gets no facts', async () => {
    jev(
      Object.fromEntries(
        ['f1', 'f2', 'f3'].map((ref): [string, Verdicts[string]] => [
          ref,
          ['not', { not: 0.9, partly: 0.05, relevant: 0.05 }],
        ]),
      ),
    )
    const out = await select(evidence({ facts: [factHit('f1', 0.9), factHit('f2', 0.8), factHit('f3', 0.7)] }))
    expect(out.facts).toEqual([])
  })

  it('the thought and note budgets still cut the relevance-ordered lists', async () => {
    jev({})
    const out = await select(
      evidence({
        retrieved: Array.from({ length: 12 }, (_, i) => thoughtHit(`t${i}`, 0.9 - i / 100)),
        noteHits: Array.from({ length: 4 }, (_, i) => noteHit(`n${i}`, 0.9 - i / 100)),
      }),
      { budgets: { thoughts: 3, notes: 2, facts: FACT_ANSWER_MAX } },
    )
    expect(out.retrieved.map((h) => h.id)).toEqual(['t0', 't1', 't2'])
    expect(out.noteHits.map((h) => h.id)).toEqual(['n0', 'n1'])
  })

  it('a fact question without facts: the same one call, over thoughts and notes only', async () => {
    jev({})
    const out = await select(
      evidence({ retrieved: [thoughtHit('a', 0.9)], noteHits: [noteHit('n1', 0.8)] }),
    )
    expect(calls()[0]!.items.map((i) => i.ref)).toEqual(['t1', 'n1'])
    expect(out.facts).toEqual([])
    expect(out.retrieved.map((h) => h.id)).toEqual(['a'])
  })

  it('nothing retrieved: no Jev call and the evidence comes back as it is', async () => {
    const e = evidence()
    const out = await select(e)
    expect(runEnforcedPerItemDecisionsMock).not.toHaveBeenCalled()
    expect(out).toEqual(e)
  })

  it('keeps everything that is not a candidate list: community themes, temporal seeds, below-floor scores, the floor', async () => {
    jev({})
    const e = evidence({
      retrieved: [thoughtHit('a', 0.9)],
      extras: {
        communityThemes: [{ communityId: 'c', level: 1, summaryText: 's' }],
        temporalSeeds: [{ thoughtId: 't' } as never],
      },
      belowFloor: { thoughts: 0.1, notePassages: 0.15 },
    })
    const out = await select(e)
    expect(out.extras).toBe(e.extras)
    expect(out.belowFloor).toBe(e.belowFloor)
    expect(out.relevanceFloor).toBe(0.22)
  })

  it('an identifier fact reaches Jev as its placeholder: no reference id, never a value', async () => {
    jev({})
    await select(
      evidence({
        facts: [
          factHit('f1', 0.9, {
            statement: "The user's licence plate is [secure:22222222-2222-4222-8222-222222222222]",
            kind: 'circumstance',
          }),
        ],
      }),
    )
    const instructions = calls()[0]!.items[0]!.instructions
    expect(instructions).toContain("The user's licence plate is [secure value]")
    expect(instructions).not.toContain('22222222')
    expect(instructions).not.toContain('[secure:')
  })

  it('shows a fact about someone else with who it is about, so it is not taken for the user', async () => {
    jev({})
    await select(
      evidence({
        facts: [
          factHit('f1', 0.9, {
            subjectKind: 'person',
            subjectLabel: 'Mia (friend)',
            statement: 'Mia (friend) drinks too little water',
            kind: 'health',
            inferred: true,
          }),
        ],
      }),
    )
    expect(calls()[0]!.items[0]!.instructions).toMatch(
      /Mia \(friend\) \(health, as of 2026-05-01, inferred\)/,
    )
  })

  it('never reaches the chat gateway, and a Jev failure fails the retrieval (no fallback to retrieval order)', async () => {
    runEnforcedPerItemDecisionsMock.mockRejectedValue(new Error('gateway down'))
    await expect(select(evidence({ retrieved: [thoughtHit('a', 0.9)] }))).rejects.toThrow(
      'gateway down',
    )
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })
})
