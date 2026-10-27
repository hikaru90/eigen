import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  deriveMock: vi.fn(),
  embedMock: vi.fn(),
  retrieveMock: vi.fn(),
  searchFactsMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/derive-delete-search-query', () => ({
  deriveDeleteSearchQueries: m.deriveMock,
}))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbeddings: m.embedMock }))
vi.mock('$lib/server/qa/retrieve-answer-evidence', () => ({
  retrieveAnswerEvidence: m.retrieveMock,
}))
vi.mock('$lib/server/facts/search-user-facts', () => ({ searchUserFacts: m.searchFactsMock }))

import { CONTEXT_WEIGHTS } from '$lib/server/retrieval'
import { FAKE_SECRETS, leaks } from '$lib/test/secret-fixtures'
import { FORGET_TOP_K_PER_PHRASE, findForgetHits } from './find-forget-hits'

const CUTOFF = new Date('2026-06-02T10:00:00.000Z')

function thought(id: string, createdAt: string, score: number) {
  return {
    id,
    normalizedText: `full text of ${id}`,
    category: 'observation',
    author: 'user',
    authorLabel: null,
    score,
    vectorScore: score,
    graphScore: 0,
    metadata: {},
    createdAt: new Date(createdAt),
  }
}

function note(id: string, createdAt: string, score: number) {
  return {
    id,
    title: `Title ${id}`,
    preview: 'p',
    excerpt: `excerpt of ${id}`,
    matchedOrdinals: [2],
    score,
    vectorScore: score,
    createdAt,
    updatedAt: createdAt,
    author: 'user',
    authorLabel: null,
    authorKeyId: null,
  }
}

function evidence(retrieved: unknown[], noteHits: unknown[], facts: unknown[] = []) {
  return {
    retrieved,
    noteHits,
    facts,
    extras: { communityThemes: [], temporalSeeds: [] },
    belowFloor: { thoughts: null, notePassages: null },
    relevanceFloor: 0.22,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.deriveMock.mockResolvedValue(['surfing', 'waves and boards'])
  m.embedMock.mockResolvedValue([[1], [2]])
  m.searchFactsMock.mockResolvedValue([])
})

describe('findForgetHits', () => {
  it("runs Ask's retrieval once per derived phrase (one embedding batch), wide pool, thoughts and notes", async () => {
    m.retrieveMock.mockResolvedValue(evidence([], []))

    const out = await findForgetHits({
      userId: 'u1',
      request: 'Please forget that I like surfing',
      createdBefore: CUTOFF,
    })

    expect(m.deriveMock).toHaveBeenCalledWith({
      userId: 'u1',
      deleteRequest: 'Please forget that I like surfing',
    })
    expect(m.embedMock).toHaveBeenCalledTimes(1)
    expect(m.embedMock).toHaveBeenCalledWith('u1', ['surfing', 'waves and boards'])
    expect(m.retrieveMock).toHaveBeenCalledTimes(2)
    expect(m.retrieveMock.mock.calls.map(([arg]) => arg)).toEqual([
      {
        userId: 'u1',
        query: 'surfing',
        queryEmbedding: [1],
        topK: FORGET_TOP_K_PER_PHRASE,
        noteTopK: FORGET_TOP_K_PER_PHRASE,
        factTopK: FORGET_TOP_K_PER_PHRASE,
        factsAsOfBefore: CUTOFF,
        weights: CONTEXT_WEIGHTS.default,
      },
      {
        userId: 'u1',
        query: 'waves and boards',
        queryEmbedding: [2],
        topK: FORGET_TOP_K_PER_PHRASE,
        noteTopK: FORGET_TOP_K_PER_PHRASE,
        factTopK: FORGET_TOP_K_PER_PHRASE,
        factsAsOfBefore: CUTOFF,
        weights: CONTEXT_WEIGHTS.default,
      },
    ])
    expect(FORGET_TOP_K_PER_PHRASE).toBe(20)
    expect(out.phrases).toEqual(['surfing', 'waves and boards'])
  })

  it('a note passage hit is a hit: it carries the note id, title and the matched excerpt', async () => {
    m.retrieveMock.mockResolvedValueOnce(
      evidence([thought('t1', '2026-06-01T00:00:00Z', 0.7)], [note('n1', '2026-05-01T00:00:00.000Z', 0.9)]),
    )
    m.retrieveMock.mockResolvedValueOnce(evidence([], []))

    const { hits } = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })

    expect(hits).toEqual([
      {
        kind: 'note',
        id: 'n1',
        title: 'Title n1',
        text: 'excerpt of n1',
        matchedOrdinals: [2],
        createdAt: new Date('2026-05-01T00:00:00.000Z'),
        score: 0.9,
      },
      {
        kind: 'thought',
        id: 't1',
        text: 'full text of t1',
        category: 'observation',
        createdAt: new Date('2026-06-01T00:00:00Z'),
        score: 0.7,
      },
    ])
  })

  it('merges phrases by best score per item and keeps only items stored strictly BEFORE the forget capture', async () => {
    m.retrieveMock.mockResolvedValueOnce(
      evidence(
        [
          thought('earlier', '2026-06-01T00:00:00Z', 0.4),
          thought('same-instant', '2026-06-02T10:00:00.000Z', 0.95),
        ],
        [note('n-old', '2026-05-01T00:00:00.000Z', 0.5), note('n-new', '2026-06-03T00:00:00.000Z', 0.99)],
      ),
    )
    m.retrieveMock.mockResolvedValueOnce(
      evidence(
        [thought('earlier', '2026-06-01T00:00:00Z', 0.8), thought('later', '2026-06-05T00:00:00Z', 0.99)],
        [note('n-old', '2026-05-01T00:00:00.000Z', 0.6)],
      ),
    )

    const { hits } = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })

    expect(hits.map((h) => `${h.kind}:${h.id}:${h.score}`)).toEqual([
      'thought:earlier:0.8',
      'note:n-old:0.6',
    ])
  })

  it('nothing retrieved: no hits (the caller keeps the instruction)', async () => {
    m.retrieveMock.mockResolvedValue(evidence([], []))
    const out = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })
    expect(out.hits).toEqual([])
  })

  it('a phrase holding a secret is redacted before it is embedded or searched', async () => {
    m.deriveMock.mockResolvedValue([`my key ${FAKE_SECRETS.openai}`])
    m.embedMock.mockResolvedValue([[1]])
    m.retrieveMock.mockResolvedValue(evidence([], []))
    await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })
    expect(leaks(JSON.stringify(m.embedMock.mock.calls))).toBe(false)
    expect(leaks(JSON.stringify(m.retrieveMock.mock.calls))).toBe(false)
  })

  describe('facts (docs/planning/user-facts-layer.md)', () => {
    const fact = (id: string, asOf: string, score: number, over: Record<string, unknown> = {}) => ({
      id,
      subjectKind: 'user',
      subjectLabel: null,
      subjectEntityId: null,
      statement: `statement of ${id}`,
      kind: 'preference',
      inferred: false,
      confidence: 0.9,
      status: 'active',
      supersededBy: null,
      asOf: new Date(asOf),
      secureValueId: null,
      sourceThoughtIds: [],
      sourceTextFileIds: [],
      score,
      vectorScore: score,
      ...over,
    })

    it('reads facts from the shared retrieval (one search path, no second fact search), only facts known BEFORE the forget capture, same wide pool', async () => {
      m.retrieveMock.mockResolvedValue(evidence([], []))

      await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })

      expect(m.searchFactsMock).not.toHaveBeenCalled()
      expect(m.retrieveMock).toHaveBeenCalledTimes(2)
      for (const [arg] of m.retrieveMock.mock.calls) {
        expect(arg).toMatchObject({
          factTopK: FORGET_TOP_K_PER_PHRASE,
          factsAsOfBefore: CUTOFF,
        })
      }
    })

    it('a fact the retrieval returned once is exactly one hit (no double hits)', async () => {
      m.retrieveMock.mockResolvedValueOnce(
        evidence([], [], [fact('f1', '2026-05-01T00:00:00Z', 0.9)]),
      )
      m.retrieveMock.mockResolvedValueOnce(evidence([], [], []))
      const { hits } = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })
      expect(hits.filter((h) => h.kind === 'fact')).toHaveLength(1)
    })

    it('a fact is a hit: id, statement in display form, who it is about, kind, as-of and score', async () => {
      m.retrieveMock.mockResolvedValueOnce(
        evidence(
          [],
          [],
          [
            fact('f1', '2026-05-01T00:00:00Z', 0.9),
            fact('f2', '2026-05-02T00:00:00Z', 0.6, {
              subjectKind: 'person',
              subjectLabel: 'Mia (friend)',
              kind: 'health',
              inferred: true,
              statement: 'Mia (friend) keeps getting headaches',
            }),
          ],
        ),
      )
      m.retrieveMock.mockResolvedValueOnce(evidence([], []))

      const { hits } = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })

      expect(hits).toEqual([
        {
          kind: 'fact',
          id: 'f1',
          text: 'statement of f1',
          subject: 'the user',
          factKind: 'preference',
          inferred: false,
          createdAt: new Date('2026-05-01T00:00:00Z'),
          score: 0.9,
        },
        {
          kind: 'fact',
          id: 'f2',
          text: 'Mia (friend) keeps getting headaches',
          subject: 'Mia (friend)',
          factKind: 'health',
          inferred: true,
          createdAt: new Date('2026-05-02T00:00:00Z'),
          score: 0.6,
        },
      ])
    })

    it('merges phrases by best score per fact and sorts facts among thoughts and notes by score', async () => {
      m.retrieveMock.mockResolvedValueOnce(
        evidence([thought('t1', '2026-06-01T00:00:00Z', 0.7)], [], [fact('f1', '2026-05-01T00:00:00Z', 0.4)]),
      )
      m.retrieveMock.mockResolvedValueOnce(evidence([], [], [fact('f1', '2026-05-01T00:00:00Z', 0.8)]))

      const { hits } = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })

      expect(hits.map((h) => `${h.kind}:${h.id}:${h.score}`)).toEqual(['fact:f1:0.8', 'thought:t1:0.7'])
    })

    it('an identifier fact is judged by its placeholder: neither the value nor the reference id is in the hit', async () => {
      m.retrieveMock.mockResolvedValueOnce(
        evidence(
          [],
          [],
          [
            fact('f1', '2026-05-01T00:00:00Z', 0.9, {
              statement: "The user's licence plate is [secure:22222222-2222-4222-8222-222222222222]",
              secureValueId: '22222222-2222-4222-8222-222222222222',
            }),
          ],
        ),
      )
      m.retrieveMock.mockResolvedValueOnce(evidence([], []))
      const { hits } = await findForgetHits({ userId: 'u1', request: 'r', createdBefore: CUTOFF })
      expect(hits[0]).toMatchObject({ text: "The user's licence plate is [secure value]" })
      expect(JSON.stringify(hits)).not.toContain('22222222')
    })
  })
})
