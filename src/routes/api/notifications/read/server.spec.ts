import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { markMock } = vi.hoisted(() => ({ markMock: vi.fn() }))
vi.mock('$lib/server/notifications/service', () => ({ markAllNotificationsRead: markMock }))

describe('POST /api/notifications/read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires auth', async () => {
    await expect(POST({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 401 })
    expect(markMock).not.toHaveBeenCalled()
  })

  it("marks the signed-in user's notifications read", async () => {
    const res = await POST({ locals: { user: { id: 'u1' } } } as never)
    expect(await res.json()).toEqual({ ok: true })
    expect(markMock).toHaveBeenCalledWith('u1')
  })
})
