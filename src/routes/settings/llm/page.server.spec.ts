import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  isUserAdminMock,
  getOrCreateWalletMock,
  isByokUiEnabledMock,
  hasSavedByokLlmCredentialsMock,
  clearLegacyByokForUserMock,
  getPayPalClientIdMock,
  getPayPalWebSdkUrlMock,
  getPayPalClientSecretMock,
  decryptTenantValueMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  isUserAdminMock: vi.fn(),
  getOrCreateWalletMock: vi.fn(),
  isByokUiEnabledMock: vi.fn(),
  hasSavedByokLlmCredentialsMock: vi.fn(),
  clearLegacyByokForUserMock: vi.fn(),
  getPayPalClientIdMock: vi.fn(),
  getPayPalWebSdkUrlMock: vi.fn(),
  getPayPalClientSecretMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/auth/user-role', () => ({ isUserAdmin: isUserAdminMock }))
vi.mock('$lib/server/billing/wallet', () => ({ getOrCreateWallet: getOrCreateWalletMock }))
vi.mock('$lib/server/billing/byok-ui', () => ({ isByokUiEnabled: isByokUiEnabledMock }))
vi.mock('$lib/server/billing/preferences', () => ({
  assertByokConfigured: vi.fn(),
  hasSavedByokLlmCredentials: hasSavedByokLlmCredentialsMock,
}))
vi.mock('$lib/server/billing/legacy-byok', () => ({
  legacyByokMigrationNeeded: (opts: {
    byokUiEnabled: boolean
    billingMode: string
    hasStoredCredentials: boolean
  }) => !opts.byokUiEnabled && (opts.billingMode === 'byok' || opts.hasStoredCredentials),
  clearLegacyByokForUser: clearLegacyByokForUserMock,
}))
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
vi.mock('$lib/server/env/private-env', () => ({
  env: {
    LLM_MODEL_CHAT: '',
    LLM_MODEL_EMBEDDING: '',
  },
}))

import { load } from './+page.server'
import { actions } from './+page.server'

function makeSelectChain(rows: unknown[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>
    where: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise<unknown>
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
    hasSavedByokLlmCredentialsMock.mockResolvedValue(false)
    clearLegacyByokForUserMock.mockResolvedValue(undefined)
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
    expect(result.legacyByokMigration).toBe(false)
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

  it('flags legacy BYOK migration when billing mode is byok and BYOK UI is disabled', async () => {
    getDbMock.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(makeSelectChain([{ billingMode: 'byok' }]))
        .mockReturnValueOnce(makeSelectChain([]))
        .mockReturnValueOnce(makeSelectChain([{ provider: 'eurouter' }])),
    })
    decryptTenantValueMock.mockResolvedValue('secret-key')

    const result = await load({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      url: new URL('http://localhost/settings/llm'),
    } as never)

    expect(result.billingMode).toBe('byok')
    expect(result.legacyByokMigration).toBe(true)
  })
})

describe('settings/llm switchToPlatformCredits action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isByokUiEnabledMock.mockReturnValue(false)
    hasSavedByokLlmCredentialsMock.mockResolvedValue(true)
    clearLegacyByokForUserMock.mockResolvedValue(undefined)
    getDbMock.mockReturnValue({
      select: vi.fn(() => makeSelectChain([{ billingMode: 'byok' }])),
    })
  })

  it('rejects unauthenticated users', async () => {
    const result = await actions.switchToPlatformCredits?.({
      locals: { user: null },
      request: new Request('http://localhost/settings/llm', { method: 'POST' }),
    } as never)

    expect(result).toMatchObject({
      status: 401,
      data: { legacyByokMessage: 'You must be signed in.' },
    })
  })

  it('clears legacy BYOK and returns platform credits billing mode', async () => {
    const result = await actions.switchToPlatformCredits?.({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      request: new Request('http://localhost/settings/llm', { method: 'POST' }),
    } as never)

    expect(clearLegacyByokForUserMock).toHaveBeenCalledWith('u1')
    expect(result).toEqual({
      legacyByokMessage:
        'Your API keys were removed. LLM calls will now use Eigen platform credits.',
      billingMode: 'platform_credits',
      legacyByokMigration: false,
    })
  })

  it('rejects when account is already on platform credits without stored keys', async () => {
    hasSavedByokLlmCredentialsMock.mockResolvedValue(false)
    getDbMock.mockReturnValue({
      select: vi.fn(() => makeSelectChain([{ billingMode: 'platform_credits' }])),
    })

    const result = await actions.switchToPlatformCredits?.({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      request: new Request('http://localhost/settings/llm', { method: 'POST' }),
    } as never)

    expect(result).toMatchObject({
      status: 400,
      data: { legacyByokMessage: 'Your account is already using Eigen platform credits.' },
    })
    expect(clearLegacyByokForUserMock).not.toHaveBeenCalled()
  })
})
