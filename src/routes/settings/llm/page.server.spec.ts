import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getOrCreateWalletMock,
  getPayPalClientIdMock,
  getPayPalWebSdkUrlMock,
  getPayPalClientSecretMock,
} = vi.hoisted(() => ({
  getOrCreateWalletMock: vi.fn(),
  getPayPalClientIdMock: vi.fn(),
  getPayPalWebSdkUrlMock: vi.fn(),
  getPayPalClientSecretMock: vi.fn(),
}))

vi.mock('$lib/server/billing/wallet', () => ({ getOrCreateWallet: getOrCreateWalletMock }))
vi.mock('$lib/server/billing/paypal', () => ({
  getPayPalClientId: getPayPalClientIdMock,
  getPayPalWebSdkUrl: getPayPalWebSdkUrlMock,
  getPayPalClientSecret: getPayPalClientSecretMock,
}))

import { load } from './+page.server'

const event = (user: { id: string } | null = { id: 'u1' }) =>
  ({ locals: { user }, url: new URL('http://x/settings/llm') }) as never

describe('settings/llm (credits only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 1200 })
    getPayPalClientIdMock.mockReturnValue('client')
    getPayPalWebSdkUrlMock.mockReturnValue('https://sdk')
    getPayPalClientSecretMock.mockReturnValue('secret')
  })

  it('redirects signed-out users to login', async () => {
    await expect(load(event(null))).rejects.toMatchObject({ status: 302, location: '/login' })
  })

  it('returns the wallet and PayPal top-up config, and nothing about API keys', async () => {
    const data = await load(event())
    expect(data).toEqual({
      wallet: { availableCredits: 1200 },
      paypalConfigured: true,
      paypalClientId: 'client',
      paypalSdkUrl: 'https://sdk',
    })
  })

  it('reports PayPal as not configured when its credentials are missing', async () => {
    getPayPalClientSecretMock.mockImplementation(() => {
      throw new Error('missing')
    })
    const data = await load(event())
    expect(data).toMatchObject({ paypalConfigured: false })
  })
})
