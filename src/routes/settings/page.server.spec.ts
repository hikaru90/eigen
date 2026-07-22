import { describe, expect, it, vi } from 'vitest'
import { actions, load } from './+page.server'

const { getDbMock, authDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  authDbMock: {
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
  },
}))
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/db/auth-db', () => ({ authDb: authDbMock }))
vi.mock('$lib/server/auth', () => ({
  auth: { api: { changeEmail: vi.fn(), changePassword: vi.fn() } },
}))
vi.mock('$lib/paraglide/runtime', () => ({
  cookieName: 'locale',
  cookieMaxAge: 31_536_000,
  locales: ['en', 'de'],
}))

describe('settings page server', () => {
  it('redirects unauthenticated load', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 })
  })
  it('returns 401 for unauthenticated actions', async () => {
    const request = new Request('http://localhost/settings', {
      method: 'POST',
      body: new URLSearchParams(),
    })
    const noUserEvent = { locals: { user: null }, request } as never
    expect(await actions.updateLanguage(noUserEvent)).toMatchObject({ status: 401 })
  })

  it('redirects after saving display language instead of treating redirect as failure', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
    const insert = vi.fn().mockReturnValue({ values })
    getDbMock.mockReturnValue({ insert })

    const cookies = { set: vi.fn() }
    const request = new Request('http://localhost/settings', {
      method: 'POST',
      body: new URLSearchParams({ preferredUiLocale: 'de' }),
    })

    await expect(
      actions.updateUiLocale({
        locals: { user: { id: 'u1' } },
        request,
        cookies,
      } as never),
    ).rejects.toMatchObject({ status: 303, location: '/settings' })

    expect(values).toHaveBeenCalledWith({ userId: 'u1', preferredUiLocale: 'de' })
    expect(cookies.set).toHaveBeenCalledWith('locale', 'de', expect.objectContaining({ path: '/' }))
  })
})
