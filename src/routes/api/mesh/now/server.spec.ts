import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }))
vi.mock('$lib/server/mesh/now-store', () => ({ loadNowCard: loadMock }))

import { GET } from './+server'

type Ev = Parameters<typeof GET>[0]
const event = (user: { id: string } | null) => ({ locals: { user } }) as unknown as Ev

describe('GET /api/mesh/now', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a signed-in user and does nothing without one', async () => {
    expect((await GET(event(null))).status).toBe(401)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('returns the card state for the signed-in user', async () => {
    const body = {
      state: 'card',
      card: { id: 'c1', kind: 'do', text: 'Call', why: 'Due', project: null, answers: ['done'] },
      remaining: 2,
      candidatesOmitted: 0,
    }
    loadMock.mockResolvedValue(body)
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
    expect(loadMock).toHaveBeenCalledWith('u1')
  })

  it.each([{ state: 'clear' }, { state: 'limit' }])('returns %o as 200', async (body) => {
    loadMock.mockResolvedValue(body)
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
  })

  it('answers 502 with the plain message after three failed attempts', async () => {
    loadMock.mockRejectedValue(new Error('the model failed 3 times'))
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/3 times/)
  })

  it('answers 402 with the billing payload when credits run out', async () => {
    loadMock.mockRejectedValue(
      Object.assign(new Error('Not enough credits'), { name: 'InsufficientCreditsError' }),
    )
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('insufficient_credits')
  })
})
