import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PatternsContractError } from '$lib/server/patterns/patterns-contract'
import { GET } from './+server'

const { getPatternsForUserMock } = vi.hoisted(() => ({ getPatternsForUserMock: vi.fn() }))

vi.mock('$lib/server/patterns/patterns-service', () => ({ getPatternsForUser: getPatternsForUserMock }))

const event = (user: { id: string } | null = { id: 'u1' }) => ({ locals: { user } }) as never

describe('GET /api/patterns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires auth', async () => {
    await expect(GET(event(null))).rejects.toMatchObject({ status: 401 })
    expect(getPatternsForUserMock).not.toHaveBeenCalled()
  })

  it("returns the user's patterns", async () => {
    getPatternsForUserMock.mockResolvedValue({ patterns: [] })
    const res = await GET(event())
    expect(await res.json()).toEqual({ patterns: [] })
    expect(getPatternsForUserMock).toHaveBeenCalledWith('u1')
  })

  it('a broken judge contract is an explicit 502, never fallback copy', async () => {
    getPatternsForUserMock.mockRejectedValue(new PatternsContractError('missing field'))
    await expect(GET(event())).rejects.toMatchObject({
      status: 502,
      body: { message: 'patterns contract: missing field' },
    })
  })

  it('other failures are rethrown as-is (fail loud)', async () => {
    const boom = new Error('db down')
    getPatternsForUserMock.mockRejectedValue(boom)
    await expect(GET(event())).rejects.toBe(boom)
  })
})
