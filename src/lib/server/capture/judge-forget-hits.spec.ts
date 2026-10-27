import { beforeEach, describe, expect, it, vi } from 'vitest'

const { llmChatCompletionMock, runEnforcedPerItemDecisionsMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
  runEnforcedPerItemDecisionsMock: vi.fn(),
}))
// The forget decisions are Jev's, asked through the plane (mocked at its boundary); the chat model
// decides none of them, so the chat gateway must never be reached from this module.
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedPerItemDecisions: runEnforcedPerItemDecisionsMock }
})

import type { ForgetHit } from './find-forget-hits'
import {
  FORGET_ACTION_CRITERIA,
  FORGET_CONFIDENCE_MIN,
  FORGET_RESIDUAL_CRITERIA,
  judgeForgetHits,
  judgeForgetResidual,
} from './judge-forget-hits'

function answer(choice: string, probabilities: Record<string, number>) {
  return {
    choice,
    probability: probabilities[choice]!,
    alternatives: Object.fromEntries(Object.entries(probabilities).filter(([k]) => k !== choice)),
  }
}

const thought = (id: string, text: string): ForgetHit => ({
  kind: 'thought',
  id,
  text,
  category: 'observation',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  score: 0.9,
})
const note = (id: string, title: string, text: string): ForgetHit => ({
  kind: 'note',
  id,
  title,
  text,
  matchedOrdinals: [1],
  createdAt: new Date('2026-05-20T00:00:00Z'),
  score: 0.8,
})

const fact = (id: string, text: string, over: Partial<Extract<ForgetHit, { kind: 'fact' }>> = {}): ForgetHit => ({
  kind: 'fact',
  id,
  text,
  subject: 'the user',
  factKind: 'habit',
  inferred: false,
  createdAt: new Date('2026-05-10T00:00:00Z'),
  score: 0.85,
  ...over,
})

type PlaneCall = {
  userId: string
  surface: string
  kind: string
  state: string
  criteria: Record<string, string>
  items: Array<{ ref: string; instructions: string; llmChoice: string | null }>
}
const planeCall = () => runEnforcedPerItemDecisionsMock.mock.calls[0]![0] as PlaneCall

beforeEach(() => {
  vi.clearAllMocks()
})

describe('FORGET_ACTION_CRITERIA (forget_action)', () => {
  it('is the closed remove_all / remove_detail / keep set, defined by meaning', () => {
    expect(Object.keys(FORGET_ACTION_CRITERIA)).toEqual(['remove_all', 'remove_detail', 'keep'])
    expect(FORGET_ACTION_CRITERIA.remove_all).toMatch(/only about the thing to forget/i)
    expect(FORGET_ACTION_CRITERIA.remove_all).toMatch(/a fact that states the forgotten thing is remove_all/i)
    expect(FORGET_ACTION_CRITERIA.remove_detail).toMatch(/other information the user did not ask to forget/i)
    expect(FORGET_ACTION_CRITERIA.keep).toMatch(/near matches/i)
    expect(FORGET_ACTION_CRITERIA.keep).toMatch(/earlier request to forget something is an instruction/i)
  })
})

describe('judgeForgetHits (forget_action, Jev)', () => {
  it('asks Jev ONE batched call with the request as state and every hit in full; maps answers back to hits', async () => {
    const long = `${'A long story about a trip. '.repeat(40)}I like surfing.`
    const hits = [
      thought('t1', 'I like surfing'),
      note('n1', 'Travel diary', long),
      thought('t2', 'I work as a nurse'),
    ]
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['h1', answer('remove_all', { remove_all: 0.95, remove_detail: 0.03, keep: 0.02 })],
        ['h2', answer('remove_detail', { remove_detail: 0.9, remove_all: 0.05, keep: 0.05 })],
        ['h3', answer('keep', { keep: 0.97, remove_all: 0.02, remove_detail: 0.01 })],
      ]),
    )

    const out = await judgeForgetHits({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      hits,
    })

    expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
    const call = planeCall()
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('forget')
    expect(call.kind).toBe('forget_action')
    expect(call.state).toBe('Forget request: Please forget that I like surfing')
    expect(call.criteria).toBe(FORGET_ACTION_CRITERIA)
    expect(call.items.map((i) => i.ref)).toEqual(['h1', 'h2', 'h3'])
    for (const item of call.items) expect(item.llmChoice).toBeNull()
    // full text, not a snippet; titles; never an id
    expect(call.items[1]!.instructions).toContain(long)
    expect(call.items[1]!.instructions).toContain('Travel diary')
    expect(JSON.stringify(call.items)).not.toContain('"t1"')
    expect(call.items.map((i) => i.instructions).join('\n')).not.toMatch(/\bt1\b|\bn1\b/)

    // the confidence is Jev's probability for the chosen action; no "detail" any more
    expect(out).toEqual([
      { hit: hits[0], action: 'remove_all', confidence: 0.95 },
      { hit: hits[1], action: 'remove_detail', confidence: 0.9 },
      { hit: hits[2], action: 'keep', confidence: 0.97 },
    ])
  })

  it('shows a fact in full with who it is about, its kind, its as-of date and whether it was inferred', async () => {
    const hits = [
      fact('f1', 'Drinks three coffees a day'),
      fact('f2', 'Mia (friend) keeps getting headaches', {
        subject: 'Mia (friend)',
        factKind: 'health',
        inferred: true,
      }),
    ]
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['h1', answer('remove_all', { remove_all: 0.95, keep: 0.05 })],
        ['h2', answer('keep', { keep: 0.9, remove_all: 0.1 })],
      ]),
    )

    const out = await judgeForgetHits({ userId: 'u1', forgetRequest: 'forget that I drink coffee', hits })

    const [first, second] = planeCall().items
    expect(first!.instructions).toContain(
      '[h1] fact about the user (habit, as of 2026-05-10):\nDrinks three coffees a day',
    )
    expect(second!.instructions).toContain(
      '[h2] fact about Mia (friend) (health, inferred, as of 2026-05-10):\nMia (friend) keeps getting headaches',
    )
    expect(out.map((j) => j.action)).toEqual(['remove_all', 'keep'])
  })

  it('no hits: no call at all', async () => {
    expect(await judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [] })).toEqual([])
    expect(runEnforcedPerItemDecisionsMock).not.toHaveBeenCalled()
  })

  it('the chat model decides nothing: the chat gateway is never reached', async () => {
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([['h1', answer('keep', { keep: 0.9, remove_all: 0.1 })]]),
    )
    await judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] })
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('fails loud on a hit Jev left unanswered or answered off the closed set, and on a Jev failure (retry ladder owns recovery)', async () => {
    runEnforcedPerItemDecisionsMock.mockResolvedValue(new Map())
    await expect(
      judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow(/no forget_action answer for h1/)

    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([['h1', answer('delete_everything', { delete_everything: 1 })]]),
    )
    await expect(
      judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow(/delete_everything/)

    runEnforcedPerItemDecisionsMock.mockRejectedValue(new Error('gateway down'))
    await expect(
      judgeForgetHits({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow('gateway down')
  })
})

describe('FORGET_RESIDUAL_CRITERIA (forget_residual)', () => {
  it('is a yes / no question: does the item still state what the user asked to forget', () => {
    expect(Object.keys(FORGET_RESIDUAL_CRITERIA)).toEqual(['yes', 'no'])
    expect(FORGET_RESIDUAL_CRITERIA.yes).toMatch(/still states or implies the thing the user asked/i)
    expect(FORGET_RESIDUAL_CRITERIA.yes).toMatch(/in whole or in part/i)
    expect(FORGET_RESIDUAL_CRITERIA.no).toMatch(/does not state or imply/i)
    expect(FORGET_RESIDUAL_CRITERIA.no).toMatch(/earlier forget request/i)
  })
})

describe('judgeForgetResidual (forget_residual, Jev)', () => {
  it('asks Jev ONE batched call over the remaining hits and reports per hit whether it still states the forgotten thing', async () => {
    const hits = [thought('t1', 'I like surfing on weekends'), fact('f1', 'Surfs on weekends')]
    runEnforcedPerItemDecisionsMock.mockResolvedValue(
      new Map([
        ['h1', answer('yes', { yes: 0.9, no: 0.1 })],
        ['h2', answer('no', { no: 0.8, yes: 0.2 })],
      ]),
    )

    const out = await judgeForgetResidual({
      userId: 'u1',
      forgetRequest: 'Please forget that I like surfing',
      hits,
    })

    expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
    const call = planeCall()
    expect(call.surface).toBe('forget')
    expect(call.kind).toBe('forget_residual')
    expect(call.state).toBe('Forget request: Please forget that I like surfing')
    expect(call.criteria).toBe(FORGET_RESIDUAL_CRITERIA)
    expect(call.items.map((i) => i.ref)).toEqual(['h1', 'h2'])
    expect(call.items[0]!.instructions).toContain('I like surfing on weekends')
    expect(call.items[1]!.instructions).toContain('fact about the user')
    expect(out).toEqual([
      { hit: hits[0], stillStates: true, probability: 0.9 },
      { hit: hits[1], stillStates: false, probability: 0.8 },
    ])
  })

  it('nothing remains: no call at all', async () => {
    expect(await judgeForgetResidual({ userId: 'u1', forgetRequest: 'r', hits: [] })).toEqual([])
    expect(runEnforcedPerItemDecisionsMock).not.toHaveBeenCalled()
  })

  it('fails loud on an unanswered hit and on a Jev failure; the chat gateway is never reached', async () => {
    runEnforcedPerItemDecisionsMock.mockResolvedValue(new Map())
    await expect(
      judgeForgetResidual({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow(/no forget_residual answer for h1/)
    runEnforcedPerItemDecisionsMock.mockRejectedValue(new Error('gateway down'))
    await expect(
      judgeForgetResidual({ userId: 'u1', forgetRequest: 'r', hits: [thought('t1', 'x')] }),
    ).rejects.toThrow('gateway down')
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })
})

describe('FORGET_CONFIDENCE_MIN', () => {
  it('is the 0.8 gate of the delete flow', () => {
    expect(FORGET_CONFIDENCE_MIN).toBe(0.8)
  })
})
