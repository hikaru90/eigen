import { describe, expect, it, vi } from 'vitest'
import { CREDITS_PER_USD } from '$lib/server/billing/credits'
import { GET } from './+server'

const { getOrCreateWalletMock } = vi.hoisted(() => ({
  getOrCreateWalletMock: vi.fn(),
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

  it('returns the wallet for the authenticated user', async () => {
    getOrCreateWalletMock.mockResolvedValue({
      availableCredits: 5000,
      reservedCredits: 100,
      pendingBillingMicroUsd: 0,
    })

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)

    expect(getOrCreateWalletMock).toHaveBeenCalledWith('u1')
    expect(await res.json()).toEqual({
      availableCredits: 5000,
      reservedCredits: 100,
      pendingBillingMicroUsd: 0,
      creditsPerUsd: CREDITS_PER_USD,
    })
  })
})
