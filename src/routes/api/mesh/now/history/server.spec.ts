import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadMock, llmMock } = vi.hoisted(() => ({ loadMock: vi.fn(), llmMock: vi.fn() }))
vi.mock('$lib/server/mesh/now-history', async () => {
  class NowHistoryCursorError extends Error {}
  return { loadNowHistory: loadMock, NowHistoryCursorError }
})
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmMock }))

import { NowHistoryCursorError } from '$lib/server/mesh/now-history'
import { GET } from './+server'

type Ev = Parameters<typeof GET>[0]
const event = (user: { id: string } | null, query = '') =>
  ({
    locals: { user },
    url: new URL(`http://localhost/api/mesh/now/history${query}`),
  }) as unknown as Ev

describe('GET /api/mesh/now/history', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a signed-in user and reads nothing without one', async () => {
    expect((await GET(event(null))).status).toBe(401)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('returns the items and cursor for the signed-in user', async () => {
    const body = {
      items: [
        {
          cardId: 'c1',
          kind: 'do',
          text: 'Call',
          answer: 'done',
          projectLabel: null,
          answeredAt: '2026-11-09T10:00:00.000Z',
          thoughtId: 't1',
        },
      ],
      nextCursor: 'abc',
    }
    loadMock.mockResolvedValue(body)
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
    expect(loadMock).toHaveBeenCalledWith('u1', {})
    expect(llmMock).not.toHaveBeenCalled()
  })

  it('passes ?before= through as the cursor', async () => {
    loadMock.mockResolvedValue({ items: [], nextCursor: null })
    await GET(event({ id: 'u1' }, '?before=abc'))
    expect(loadMock).toHaveBeenCalledWith('u1', { before: 'abc' })
  })

  it('answers 400 for a cursor it did not issue', async () => {
    loadMock.mockRejectedValue(new NowHistoryCursorError('bad'))
    const res = await GET(event({ id: 'u1' }, '?before=zzz'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/bad/)
  })

  it('answers 500 with the message on any other failure', async () => {
    loadMock.mockRejectedValue(new Error('db down'))
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
