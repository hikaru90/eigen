import { beforeEach, describe, expect, it, vi } from 'vitest'

const { answerMock } = vi.hoisted(() => ({ answerMock: vi.fn() }))
vi.mock('$lib/server/mesh/now-answer', async () => {
  class NowAnswerError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }
  return { answerNowCard: answerMock, NowAnswerError }
})

import { NowAnswerError } from '$lib/server/mesh/now-answer'
import { POST } from './+server'

type Ev = Parameters<typeof POST>[0]
const CARD = '11111111-1111-4111-8111-111111111111'
const event = (user: { id: string } | null, body: unknown, raw?: string) =>
  ({
    locals: { user },
    params: { id: CARD },
    request: new Request('http://localhost/api/mesh/now/cards/x/answer', {
      method: 'POST',
      body: raw ?? JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  }) as unknown as Ev

describe('POST /api/mesh/now/cards/[id]/answer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 without a user, and does nothing', async () => {
    expect((await POST(event(null, { answer: 'done' }))).status).toBe(401)
    expect(answerMock).not.toHaveBeenCalled()
  })

  it('200 with the next state and undo, passing the user, card and body', async () => {
    const body = { state: 'clear', undo: { cardId: CARD } }
    answerMock.mockResolvedValue(body)
    const res = await POST(event({ id: 'u1' }, { answer: 'other_project', projectEntityId: 'p1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
    expect(answerMock).toHaveBeenCalledWith({
      userId: 'u1',
      cardId: CARD,
      answer: 'other_project',
      projectEntityId: 'p1',
    })
  })

  it('passes text through for something_else', async () => {
    answerMock.mockResolvedValue({ state: 'clear', undo: null })
    await POST(event({ id: 'u1' }, { answer: 'something_else', text: 'Call' }))
    expect(answerMock).toHaveBeenCalledWith({ userId: 'u1', cardId: CARD, answer: 'something_else', text: 'Call' })
  })

  it.each([
    ['invalid JSON', undefined, '{nope'],
    ['an array', [], undefined],
    ['null', null, undefined],
    ['a missing answer', {}, undefined],
    ['a non-string answer', { answer: 3 }, undefined],
    ['an unknown field', { answer: 'done', extra: 1 }, undefined],
    ['a non-string projectEntityId', { answer: 'other_project', projectEntityId: 5 }, undefined],
    ['a non-string text', { answer: 'something_else', text: {} }, undefined],
  ])('400 for %s, before any work', async (_name, body, raw) => {
    const res = await POST(event({ id: 'u1' }, body, raw))
    expect(res.status).toBe(400)
    expect(typeof (await res.json()).error).toBe('string')
    expect(answerMock).not.toHaveBeenCalled()
  })

  it.each([400, 404, 409])('maps a NowAnswerError %i to that status with its message', async (status) => {
    answerMock.mockRejectedValue(new NowAnswerError(status, 'plain message'))
    const res = await POST(event({ id: 'u1' }, { answer: 'done' }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'plain message' })
  })

  it('402 with the billing payload when capturing the step runs out of credits', async () => {
    answerMock.mockRejectedValue(
      Object.assign(new Error('Not enough credits'), { name: 'InsufficientCreditsError' }),
    )
    const res = await POST(event({ id: 'u1' }, { answer: 'yes' }))
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('insufficient_credits')
  })

  it('500 with the plain message for any other failure', async () => {
    answerMock.mockRejectedValue(new Error('graph is down'))
    const res = await POST(event({ id: 'u1' }, { answer: 'done' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'graph is down' })
  })
})
