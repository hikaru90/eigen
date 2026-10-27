import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runEnforcedPerItemDecisionsMock, llmChatCompletionMock } = vi.hoisted(() => ({
  runEnforcedPerItemDecisionsMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
}))

// Relevance is Jev's decision, asked through the plane; the chat gateway must never be reached.
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedPerItemDecisions: runEnforcedPerItemDecisionsMock }
})
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))

import {
  EVIDENCE_ITEM_MAX_CHARS,
  EVIDENCE_RELEVANCE_CRITERIA,
  judgeEvidenceRelevance,
  rankByRelevance,
  type EvidenceVerdict,
} from './reranker'

function answer(choice: string, probabilities: Record<string, number>) {
  return {
    choice,
    probability: probabilities[choice]!,
    alternatives: Object.fromEntries(Object.entries(probabilities).filter(([k]) => k !== choice)),
  }
}

const candidates = [
  { ref: 't1', label: 'Stored thought, 2026-05-01', text: 'Mild myopia, wears glasses at the desk' },
  { ref: 'n1', label: 'Excerpt of the note "Diary", 2026-04-02', text: 'Went to the market on Saturday' },
  { ref: 'f1', label: 'Known fact about Mia (friend) (health, as of 2026-03-03)', text: 'Mia gets headaches' },
]

beforeEach(() => {
  vi.clearAllMocks()
  runEnforcedPerItemDecisionsMock.mockResolvedValue(
    new Map([
      ['t1', answer('relevant', { relevant: 0.9, partly: 0.08, not: 0.02 })],
      ['n1', answer('not', { not: 0.8, partly: 0.15, relevant: 0.05 })],
      ['f1', answer('partly', { partly: 0.6, relevant: 0.2, not: 0.2 })],
    ]),
  )
})

describe('judgeEvidenceRelevance (evidence_relevance, Jev)', () => {
  it('asks Jev ONE batched call: the question as state, one question per candidate, no chat comparison', async () => {
    await judgeEvidenceRelevance({
      userId: 'u1',
      question: 'Any tips against eye strain?',
      candidates,
    })

    expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
    const call = runEnforcedPerItemDecisionsMock.mock.calls[0]![0] as {
      userId: string
      surface: string
      kind: string
      state: string
      criteria: Record<string, string>
      items: Array<{ ref: string; instructions: string; llmChoice: string | null }>
    }
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('evidence')
    expect(call.kind).toBe('evidence_relevance')
    expect(call.state).toBe('Question: Any tips against eye strain?')
    expect(call.criteria).toBe(EVIDENCE_RELEVANCE_CRITERIA)
    expect(call.items.map((i) => i.ref)).toEqual(['t1', 'n1', 'f1'])
    for (const item of call.items) expect(item.llmChoice).toBeNull()
    expect(call.items[0]!.instructions).toContain('Stored thought, 2026-05-01')
    expect(call.items[0]!.instructions).toContain('Mild myopia, wears glasses at the desk')
    expect(call.items[2]!.instructions).toContain('Known fact about Mia (friend)')
  })

  it('the criteria are a closed relevant / partly / not set, defined by what the answer needs', () => {
    expect(Object.keys(EVIDENCE_RELEVANCE_CRITERIA)).toEqual(['relevant', 'partly', 'not'])
    expect(EVIDENCE_RELEVANCE_CRITERIA.relevant).toMatch(/directly helps answer the question/i)
    expect(EVIDENCE_RELEVANCE_CRITERIA.relevant).toMatch(/a good answer must take into account/i)
    expect(EVIDENCE_RELEVANCE_CRITERIA.partly).toMatch(/could add useful context/i)
    expect(EVIDENCE_RELEVANCE_CRITERIA.not).toMatch(/shares a topic or a word/i)
  })

  it('returns a verdict per candidate: the choice, its probability and an expected-relevance score', async () => {
    const verdicts = await judgeEvidenceRelevance({ userId: 'u1', question: 'q', candidates })

    expect(verdicts.get('t1')).toMatchObject({ choice: 'relevant', probability: 0.9 })
    expect(verdicts.get('t1')!.score).toBeCloseTo(0.9 + 0.5 * 0.08, 10)
    expect(verdicts.get('n1')).toMatchObject({ choice: 'not', probability: 0.8 })
    expect(verdicts.get('n1')!.score).toBeCloseTo(0.05 + 0.5 * 0.15, 10)
    expect(verdicts.get('f1')).toMatchObject({ choice: 'partly', probability: 0.6 })
    expect(verdicts.get('f1')!.score).toBeCloseTo(0.2 + 0.5 * 0.6, 10)
  })

  it('caps one item at the character budget so a long note excerpt cannot flood the call', async () => {
    const long = 'x'.repeat(EVIDENCE_ITEM_MAX_CHARS + 500)
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([['t1', answer('relevant', { relevant: 1 })]]),
    )
    await judgeEvidenceRelevance({
      userId: 'u1',
      question: 'q',
      candidates: [{ ref: 't1', label: 'Stored thought', text: long }],
    })
    const instructions = (
      runEnforcedPerItemDecisionsMock.mock.calls[0]![0] as { items: Array<{ instructions: string }> }
    ).items[0]!.instructions
    expect(instructions.match(/x/g)!.length).toBe(EVIDENCE_ITEM_MAX_CHARS)
  })

  it('no candidates: no call at all', async () => {
    const verdicts = await judgeEvidenceRelevance({ userId: 'u1', question: 'q', candidates: [] })
    expect(verdicts.size).toBe(0)
    expect(runEnforcedPerItemDecisionsMock).not.toHaveBeenCalled()
  })

  it('never reaches the chat gateway: the chat model decides no relevance', async () => {
    await judgeEvidenceRelevance({ userId: 'u1', question: 'q', candidates })
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('fails loud on a candidate Jev left unanswered, a duplicate ref or a blank question', async () => {
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([['t1', answer('relevant', { relevant: 1 })]]),
    )
    await expect(
      judgeEvidenceRelevance({ userId: 'u1', question: 'q', candidates }),
    ).rejects.toThrow(/no relevance answer for "n1"/)
    await expect(
      judgeEvidenceRelevance({ userId: 'u1', question: 'q', candidates: [candidates[0]!, candidates[0]!] }),
    ).rejects.toThrow(/duplicate candidate ref "t1"/)
    await expect(
      judgeEvidenceRelevance({ userId: 'u1', question: '   ', candidates }),
    ).rejects.toThrow(/question must be non-empty/)
  })

  it('propagates a Jev failure (no fallback to fusion order, no chat rerank)', async () => {
    runEnforcedPerItemDecisionsMock.mockRejectedValue(
      new Error('[decision-plane] enforced evidence_relevance per-item decision failed: gateway down'),
    )
    await expect(
      judgeEvidenceRelevance({ userId: 'u1', question: 'q', candidates }),
    ).rejects.toThrow('gateway down')
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })
})

describe('rankByRelevance', () => {
  const verdict = (choice: EvidenceVerdict['choice'], score: number): EvidenceVerdict => ({
    choice,
    probability: 0.9,
    score,
  })
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))

  it('drops every candidate Jev judged not relevant and orders the rest by relevance, best first', () => {
    const verdicts = new Map<string, EvidenceVerdict>([
      ['a', verdict('partly', 0.4)],
      ['b', verdict('not', 0.9)],
      ['c', verdict('relevant', 0.95)],
      ['d', verdict('not', 0.1)],
      ['e', verdict('relevant', 0.8)],
    ])
    expect(rankByRelevance(items, (i) => i.id, verdicts).map((i) => i.id)).toEqual(['c', 'e', 'a'])
  })

  it('keeps the incoming order between equally relevant candidates (stable)', () => {
    const verdicts = new Map<string, EvidenceVerdict>(
      items.map((i) => [i.id, verdict('relevant', 0.7)]),
    )
    expect(rankByRelevance(items, (i) => i.id, verdicts).map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])
  })

  it('fails loud when a candidate has no verdict', () => {
    expect(() => rankByRelevance(items, (i) => i.id, new Map())).toThrow(/no verdict for "a"/)
  })
})
