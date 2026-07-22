import { describe, expect, it, vi } from 'vitest'
import { load } from './+layout.server'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/auth/user-role', () => ({ isUserAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock('$lib/i18n/ui-locale', () => ({ normalizeUiLocale: (value: string) => value }))
vi.mock('$lib/paraglide/runtime', () => ({ cookieName: 'locale', cookieMaxAge: 31_536_000 }))

function makeCookies() {
  return {
    get: vi.fn(() => undefined),
    set: vi.fn(),
  }
}

describe('layout server load', () => {
  it('returns user or null', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([{ preferredUiLocale: 'en', preferredLanguage: 'de' }]),
            then(
              onFulfilled?: (value: unknown) => unknown,
              onRejected?: (error: unknown) => unknown,
            ) {
              return Promise.resolve([]).then(onFulfilled, onRejected)
            },
          }),
        }),
      }),
      selectDistinct: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const cookies = makeCookies()
    await expect(load({ locals: { user: { id: 'u1' } }, cookies } as never)).resolves.toEqual({
      user: { id: 'u1' },
      isAdmin: false,
      preferredUiLocale: 'en',
      preferredLanguage: 'de',
      authorLayers: [{ key: 'user', label: 'You', kind: 'user' }],
    })

    await expect(load({ locals: { user: undefined }, cookies } as never)).resolves.toEqual({
      user: null,
      isAdmin: false,
      preferredUiLocale: null,
      preferredLanguage: 'en',
      authorLayers: [],
    })
  })
})
