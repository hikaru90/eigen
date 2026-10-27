import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  withEvalDb: vi.fn(),
  getOrCreateSession: vi.fn(),
  runAskTurn: vi.fn(),
}))

vi.mock('../harness/eval-context', () => ({ withEvalDb: m.withEvalDb }))
vi.mock('$lib/server/chat/run-ask-turn', () => ({
  getOrCreateSession: m.getOrCreateSession,
  runAskTurn: m.runAskTurn,
}))

import type { ComposedAnswer } from '$lib/server/qa/compose-answer'
import { observeBelowFloor, observeComposedAnswer } from '$lib/server/qa/compose-observer'
import { answerViaAsk } from './ask-answer'

const TENANT = 'public-bench-personamem-v2-capture-gpt-4o-mini-p7-qaaaaaaaaaaaa'
const DB = { fake: 'db' }
const REFERENCE = new Date('2025-01-03T00:00:00.000Z')
const billing = { billingUserId: 'public-bench-operator', chatModel: 'openai/gpt-4o-mini' }

const item = (id: string, text: string) => ({
  id,
  normalizedText: text,
  score: 0.5,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
})
const composed = (...items: ReturnType<typeof item>[]) =>
  ({ context: items, retrieved: items.slice(0, 1) }) as unknown as ComposedAnswer

beforeEach(() => {
  vi.clearAllMocks()
  m.withEvalDb.mockImplementation((_tenant, fn) => fn(DB))
  m.getOrCreateSession.mockResolvedValue({ sessionId: 'sess-1', mode: 'default' })
})

describe('answerViaAsk', () => {
  it('opens a new session and sends only the query, under the reference-time clock', async () => {
    m.runAskTurn.mockResolvedValue({ answer: 'Green tea.', toolCalls: [] })
    await answerViaAsk({
      tenantUserId: TENANT,
      query: 'Suggest a drink?',
      referenceTime: REFERENCE,
      billing,
    })

    expect(m.withEvalDb).toHaveBeenCalledTimes(1)
    expect(m.withEvalDb.mock.calls[0]![0]).toBe(TENANT)
    expect(m.withEvalDb.mock.calls[0]![2]).toEqual({ ...billing, clock: REFERENCE })
    expect(m.getOrCreateSession).toHaveBeenCalledWith(DB, TENANT, null, 'default')
    expect(m.runAskTurn).toHaveBeenCalledWith({
      db: DB,
      userId: TENANT,
      sessionId: 'sess-1',
      message: 'Suggest a drink?',
    })
  })

  it('gives the chooser the full context of every answer_question call, deduplicated', async () => {
    m.runAskTurn.mockImplementation(async () => {
      observeComposedAnswer(TENANT, composed(item('a', 'one'), item('b', 'two')))
      observeComposedAnswer(TENANT, composed(item('b', 'two'), item('c', 'three')))
      return {
        answer: 'Green tea.',
        toolCalls: [
          { tool: 'answer_question', arguments: {}, failed: false },
          { tool: 'answer_question', arguments: {}, failed: false },
        ],
      }
    })
    const result = await answerViaAsk({
      tenantUserId: TENANT,
      query: 'q',
      referenceTime: REFERENCE,
      billing,
    })
    expect(result.context.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(result.answer).toBe('Green tea.')
    expect(result.toolNames).toEqual(['answer_question', 'answer_question'])
    expect(result.askAnsweredWithoutMemory).toBe(false)
  })

  it('flags an answer without any answer_question call and gives an empty context', async () => {
    m.runAskTurn.mockResolvedValue({ answer: 'I do not know.', toolCalls: [] })
    const result = await answerViaAsk({
      tenantUserId: TENANT,
      query: 'q',
      referenceTime: REFERENCE,
      billing,
    })
    expect(result.context).toEqual([])
    expect(result.askAnsweredWithoutMemory).toBe(true)
  })

  it('reports the best candidate under the relevance floor over all answer_question calls', async () => {
    m.runAskTurn.mockImplementation(async () => {
      observeBelowFloor(TENANT, { thoughts: 0.1, notePassages: null })
      observeComposedAnswer(TENANT, composed())
      observeBelowFloor(TENANT, { thoughts: 0.18, notePassages: 0.07 })
      observeComposedAnswer(TENANT, composed())
      return { answer: 'x', toolCalls: [] }
    })
    const result = await answerViaAsk({
      tenantUserId: TENANT,
      query: 'q',
      referenceTime: REFERENCE,
      billing,
    })
    expect(result.belowFloor).toEqual({ thoughts: 0.18, notePassages: 0.07 })
  })

  it('has no below-floor scores when Ask never composed an answer', async () => {
    m.runAskTurn.mockResolvedValue({ answer: 'I do not know.', toolCalls: [] })
    const result = await answerViaAsk({
      tenantUserId: TENANT,
      query: 'q',
      referenceTime: REFERENCE,
      billing,
    })
    expect(result.belowFloor).toEqual({ thoughts: null, notePassages: null })
  })

  it('refuses a non-harness tenant', async () => {
    m.runAskTurn.mockResolvedValue({ answer: 'x', toolCalls: [] })
    await expect(
      answerViaAsk({ tenantUserId: 'real-user', query: 'q', referenceTime: REFERENCE, billing }),
    ).rejects.toThrow(/harness billing users/)
  })
})
