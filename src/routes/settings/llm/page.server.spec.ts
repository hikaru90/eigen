import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  isUserAdminMock,
  getOrCreateWalletMock,
  isByokUiEnabledMock,
  getPayPalClientIdMock,
  getPayPalWebSdkUrlMock,
  getPayPalClientSecretMock,
  decryptTenantValueMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  isUserAdminMock: vi.fn(),
  getOrCreateWalletMock: vi.fn(),
  isByokUiEnabledMock: vi.fn(),
  getPayPalClientIdMock: vi.fn(),
  getPayPalWebSdkUrlMock: vi.fn(),
  getPayPalClientSecretMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/auth/user-role', () => ({ isUserAdmin: isUserAdminMock }))
vi.mock('$lib/server/billing/wallet', () => ({ getOrCreateWallet: getOrCreateWalletMock }))
vi.mock('$lib/server/billing/byok-ui', () => ({ isByokUiEnabled: isByokUiEnabledMock }))
vi.mock('$lib/server/billing/paypal', () => ({
  getPayPalClientId: getPayPalClientIdMock,
  getPayPalWebSdkUrl: getPayPalWebSdkUrlMock,
  getPayPalClientSecret: getPayPalClientSecretMock,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptTenantValueMock,
  encryptTenantValue: vi.fn(),
}))
vi.mock('$lib/server/analytics/posthog-server', () => ({
  captureServerEvent: vi.fn(),
}))
vi.mock('$env/dynamic/private', () => ({
  env: {
    LLM_MODEL_CHAT: '',
    LLM_MODEL_EMBEDDING: '',
  },
}))

import { load } from './+page.server'

function makeSelectChain(rows: unknown[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>
    where: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise<unknown>
  } = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(async () => rows),
    then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  return chain
}

describe('settings/llm page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isUserAdminMock.mockResolvedValue(false)
    getOrCreateWalletMock.mockResolvedValue({
      availableCredits: 0,
      reservedCredits: 0,
      pendingBillingMicroUsd: 0,
    })
    isByokUiEnabledMock.mockReturnValue(false)
    getPayPalClientIdMock.mockImplementation(() => {
      throw new Error('paypal not configured')
    })
    getDbMock.mockReturnValue({
      select: vi.fn(() => makeSelectChain([])),
    })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(
      load({
        locals: { user: null },
        url: new URL('http://localhost/settings/llm'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' })
  })

  it('returns empty LLM settings shape without throwing when authenticated', async () => {
    const result = await load({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      url: new URL('http://localhost/settings/llm'),
    } as never)

    expect(result.isAdmin).toBe(false)
    expect(result.billingMode).toBe('platform_credits')
    expect(result.byokUiEnabled).toBe(false)
    expect(result.byokConfigured).toBe(false)
    expect(result.wallet).toEqual({
      availableCredits: 0,
      reservedCredits: 0,
      pendingBillingMicroUsd: 0,
    })
    expect(result.paypalConfigured).toBe(false)
    expect(result.activeProvider).toBe('eurouter')
    expect(result.initialTab).toBe('credits')
    expect(result.providers.eurouter.configured).toBe(false)
    expect(result.providers.openrouter.configured).toBe(false)
    expect(result.providers.eurouter.apiKey).toBe('')
    expect(result.providers.openrouter.apiKey).toBe('')
  })
})
