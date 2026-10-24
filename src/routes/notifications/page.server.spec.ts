import { describe, expect, it, vi } from 'vitest'
import { load } from './+page.server'

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }))
vi.mock('$lib/server/notifications/service', () => ({ listNotifications: listMock }))

describe('notifications page load', () => {
  it('redirects signed-out users to login', async () => {
    await expect(load({ locals: { user: null }, depends: vi.fn() } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it("lists the user's notifications", async () => {
    listMock.mockResolvedValue([{ id: 'n1' }])
    const out = await load({ locals: { user: { id: 'u1' } }, depends: vi.fn() } as never)
    expect(out).toEqual({ notifications: [{ id: 'n1' }] })
    expect(listMock).toHaveBeenCalledWith('u1')
  })
})
