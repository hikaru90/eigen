import { describe, expect, it, vi } from 'vitest'
import { load } from './+page.server'

const m = vi.hoisted(() => ({ digest: vi.fn(), tz: vi.fn() }))
vi.mock('$lib/server/memory/daily-digest', () => ({ loadDailyDigest: m.digest }))
vi.mock('$lib/server/memory/user-timezone', () => ({ getUserPreferredTimezone: m.tz }))

describe('summary page load', () => {
  it('redirects signed-out users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it("loads the user's daily digest in their timezone", async () => {
    m.tz.mockResolvedValue('Europe/Berlin')
    m.digest.mockResolvedValue({ projects: [] })
    const out = await load({ locals: { user: { id: 'u1' } } } as never)
    expect(m.digest).toHaveBeenCalledWith('u1', 'Europe/Berlin')
    expect(out).toEqual({ digest: { projects: [] } })
  })
})
