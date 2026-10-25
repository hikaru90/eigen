import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ withEvalDb: vi.fn(), composeAnswer: vi.fn() }))

vi.mock('../harness/eval-context', () => ({ withEvalDb: m.withEvalDb }))
vi.mock('$lib/server/qa/compose-answer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/qa/compose-answer')>()),
  composeAnswer: m.composeAnswer,
}))

import { observeBelowFloor } from '$lib/server/qa/compose-observer'
import { answerViaCompose } from './compose-direct'

const TENANT = 'public-bench-personamem-v2-capture-gpt-4o-mini-val-p7-qaaaaaaaaaaaa'
const REFERENCE = new Date('2025-01-03T00:00:00.000Z')
const billing = { billingUserId: 'public-bench-operator', chatModel: 'openai/gpt-4o-mini' }
const context = [
  {
    id: 't1',
    normalizedText: 'Likes green tea',
    score: 0.5,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.withEvalDb.mockImplementation((_tenant, fn) => fn({}))
})

describe('answerViaCompose', () => {
  it('runs composeAnswer on the bare query at the reference time and returns its context and cited ids', async () => {
    m.composeAnswer.mockResolvedValue({
      answer: 'Answer: tea.',
      context,
      retrieved: context,
    })
    const result = await answerViaCompose({
      tenantUserId: TENANT,
      query: 'A drink?',
      referenceTime: REFERENCE,
      billing,
    })
    expect(m.composeAnswer).toHaveBeenCalledWith({
      userId: TENANT,
      question: 'A drink?',
      referenceTime: REFERENCE,
    })
    expect(m.withEvalDb.mock.calls[0]![0]).toBe(TENANT)
    expect(result.context).toBe(context)
    expect(result.citedIds).toEqual(['t1'])
    expect(result.answerText).toContain('tea')
  })

  it('returns what composeAnswer reported to the observer as the below-floor scores', async () => {
    m.composeAnswer.mockImplementation(async () => {
      observeBelowFloor(TENANT, { thoughts: 0.19, notePassages: 0.03 })
      return { answer: 'Not in memory', context: [], retrieved: [] }
    })
    const result = await answerViaCompose({
      tenantUserId: TENANT,
      query: 'q',
      referenceTime: REFERENCE,
      billing,
    })
    expect(result.context).toEqual([])
    expect(result.belowFloor).toEqual({ thoughts: 0.19, notePassages: 0.03 })
  })

  it('refuses a non-harness tenant', async () => {
    m.composeAnswer.mockResolvedValue({ answer: 'x', context: [], retrieved: [] })
    await expect(
      answerViaCompose({
        tenantUserId: 'real-user',
        query: 'q',
        referenceTime: REFERENCE,
        billing,
      }),
    ).rejects.toThrow(/harness billing users/)
  })
})
