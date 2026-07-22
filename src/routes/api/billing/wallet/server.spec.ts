import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'
import { CREDITS_PER_USD } from '$lib/server/billing/credits'

const { getBillingPreferencesMock, getOrCreateWalletMock } = vi.hoisted(() => ({
  getBillingPreferencesMock: vi.fn(),
  getOrCreateWalletMock: vi.fn(),
}))

vi.mock('$lib/server/billing/preferences', () => ({
  getBillingPreferences: getBillingPreferencesMock,
}))
vi.mock('$lib/server/billing/wallet', () => ({
  getOrCreateWallet: getOrCreateWalletMock,
}))

describe('GET /api/billing/wallet', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await GET({ locals: { user: null } } as never)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns wallet and billing preferences for authenticated user', async () => {
    getBillingPreferencesMock.mockResolvedValue({ billingMode: 'prepaid' })
    getOrCreateWalletMock.mockResolvedValue({
      availableCredits: 5000,
      reservedCredits: 100,
      pendingBillingMicroUsd: 0,
    })

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)

    expect(getBillingPreferencesMock).toHaveBeenCalledWith('u1')
    expect(getOrCreateWalletMock).toHaveBeenCalledWith('u1')
    expect(await res.json()).toEqual({
      availableCredits: 5000,
      reservedCredits: 100,
      pendingBillingMicroUsd: 0,
      billingMode: 'prepaid',
      creditsPerUsd: CREDITS_PER_USD,
    })
  })
})
