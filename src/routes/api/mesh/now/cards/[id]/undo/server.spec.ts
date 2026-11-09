import { beforeEach, describe, expect, it, vi } from 'vitest'

const { undoMock } = vi.hoisted(() => ({ undoMock: vi.fn() }))
vi.mock('$lib/server/mesh/now-answer', async () => {
  class NowAnswerError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }
  return { undoNowCard: undoMock, NowAnswerError }
})

import { NowAnswerError } from '$lib/server/mesh/now-answer'
import { POST } from './+server'

type Ev = Parameters<typeof POST>[0]
const CARD = '11111111-1111-4111-8111-111111111111'
const event = (user: { id: string } | null) =>
  ({ locals: { user }, params: { id: CARD } }) as unknown as Ev

describe('POST /api/mesh/now/cards/[id]/undo', () => {
  beforeEach(() => vi.clearAllMocks())

  it('401 without a user, and does nothing', async () => {
    expect((await POST(event(null))).status).toBe(401)
    expect(undoMock).not.toHaveBeenCalled()
  })

  it('200 returns the card again', async () => {
    const body = { state: 'card', card: { id: CARD }, remaining: 1, candidatesOmitted: 0 }
    undoMock.mockResolvedValue(body)
    const res = await POST(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
    expect(undoMock).toHaveBeenCalledWith({ userId: 'u1', cardId: CARD })
  })

  it.each([404, 409])('maps a NowAnswerError %i to that status with its message', async (status) => {
    undoMock.mockRejectedValue(new NowAnswerError(status, 'plain message'))
    const res = await POST(event({ id: 'u1' }))
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: 'plain message' })
  })

  it('500 with the plain message for any other failure', async () => {
    undoMock.mockRejectedValue(new Error('graph is down'))
    const res = await POST(event({ id: 'u1' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'graph is down' })
  })
})
