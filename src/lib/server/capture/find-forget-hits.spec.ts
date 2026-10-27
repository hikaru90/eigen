import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  deriveMock: vi.fn(),
  embedMock: vi.fn(),
  retrieveMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/derive-delete-search-query', () => ({
  deriveDeleteSearchQueries: m.deriveMock,
}))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbeddings: m.embedMock }))
vi.mock('$lib/server/qa/retrieve-answer-evidence', () => ({
  retrieveAnswerEvidence: m.retrieveMock,
}))

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

function evidence(retrieved: unknown[], noteHits: unknown[]) {
  return {
    retrieved,
    noteHits,
    extras: { communityThemes: [], temporalSeeds: [] },
    belowFloor: { thoughts: null, notePassages: null },
    relevanceFloor: 0.22,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.deriveMock.mockResolvedValue(['surfing', 'waves and boards'])
  m.embedMock.mockResolvedValue([[1], [2]])
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
        weights: CONTEXT_WEIGHTS.default,
      },
      {
        userId: 'u1',
        query: 'waves and boards',
        queryEmbedding: [2],
        topK: FORGET_TOP_K_PER_PHRASE,
        noteTopK: FORGET_TOP_K_PER_PHRASE,
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
})
