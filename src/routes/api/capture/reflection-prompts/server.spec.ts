import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadMock, dismissMock } = vi.hoisted(() => ({ loadMock: vi.fn(), dismissMock: vi.fn() }))
vi.mock('$lib/server/capture/reflection-prompt-store', () => ({
  loadTodaysReflectionPrompts: loadMock,
  dismissTodaysReflectionPrompts: dismissMock,
}))

import { GET, POST } from './+server'

type Ev = Parameters<typeof GET>[0]
const event = (user: { id: string } | null) => ({ locals: { user } }) as unknown as Ev

describe('/api/capture/reflection-prompts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires a signed-in user', async () => {
    expect((await GET(event(null))).status).toBe(401)
    expect((await POST(event(null))).status).toBe(401)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it("returns today's state", async () => {
    loadMock.mockResolvedValue({ state: 'ready', prompts: ['How is the shed going?'] })
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state: 'ready', prompts: ['How is the shed going?'] })
    expect(loadMock).toHaveBeenCalledWith('u1')
  })

  it('says plainly when the questions could not be written (RP-2)', async () => {
    loadMock.mockRejectedValue(new Error('the model failed 3 times'))
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/3 times/)
  })

  it('answers 402 when credits run out', async () => {
    loadMock.mockRejectedValue(
      Object.assign(new Error('Not enough credits'), { name: 'InsufficientCreditsError' }),
    )
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('insufficient_credits')
  })

  it('dismisses today (RP-5)', async () => {
    dismissMock.mockResolvedValue(undefined)
    const res = await POST(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(dismissMock).toHaveBeenCalledWith('u1')
  })
})
