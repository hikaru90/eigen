import { describe, expect, it, vi } from 'vitest'
import { load } from './+layout.server'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/auth/user-role', () => ({ isUserAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock('$lib/i18n/ui-locale', () => ({ normalizeUiLocale: (value: string) => value }))
vi.mock('$lib/server/memory/you-counts', () => ({
  loadYouCounts: vi.fn().mockResolvedValue({ thoughts: 4, threads: 2, apiKeys: 1 }),
}))
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
              .mockResolvedValue([
                {
                  preferredUiLocale: 'en',
                  preferredLanguage: 'de',
                  betaAgreementAcceptedAt: null,
                },
              ]),
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
      betaAgreementAccepted: false,
      authorLayers: [{ key: 'user', label: 'You', kind: 'user' }],
      youCounts: { thoughts: 4, threads: 2, apiKeys: 1 },
    })

    await expect(load({ locals: { user: undefined }, cookies } as never)).resolves.toEqual({
      user: null,
      isAdmin: false,
      preferredUiLocale: null,
      preferredLanguage: 'en',
      betaAgreementAccepted: true,
      authorLayers: [],
      youCounts: null,
    })
  })

  it('reports betaAgreementAccepted: true when the user has accepted', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                {
                  preferredUiLocale: 'en',
                  preferredLanguage: 'en',
                  betaAgreementAcceptedAt: new Date('2026-09-01T00:00:00Z'),
                },
              ]),
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
    await expect(load({ locals: { user: { id: 'u1' } }, cookies } as never)).resolves.toMatchObject({
      betaAgreementAccepted: true,
    })
  })
})
