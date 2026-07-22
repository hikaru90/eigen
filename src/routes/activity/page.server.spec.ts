import { beforeEach, describe, expect, it, vi } from 'vitest'
import { load } from './+page.server'

const { getOrCreateWalletMock } = vi.hoisted(() => ({
  getOrCreateWalletMock: vi.fn(),
}))
vi.mock('$lib/server/billing/wallet', () => ({ getOrCreateWallet: getOrCreateWalletMock }))

describe('activity page server', () => {
  beforeEach(() => {
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 5000 })
  })

  it('redirects unauthenticated user', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 })
  })

  it('returns initial empty data with wallet credits', async () => {
    const data = await load({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      url: new URL('http://localhost/activity'),
    } as never)

    expect(data.walletAvailableCredits).toBe(5000)
    expect(data.calls).toEqual([])
    expect(data.totals).toEqual({
      baseCostUsd: '0.000000',
      markupUsd: '0.000000',
      totalCostUsd: '0.000000',
    })
    expect(data.overallTotals).toEqual({
      baseCostUsd: '0.000000',
      markupUsd: '0.000000',
      totalCostUsd: '0.000000',
    })
    expect(data.from).toBeNull()
    expect(data.to).toBeNull()
    expect(data.pagination).toEqual({
      page: 1,
      pageSize: 20,
      totalCount: 0,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    })
  })
})
