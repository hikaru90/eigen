import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listAdminSpendByUserMock } = vi.hoisted(() => ({
  listAdminSpendByUserMock: vi.fn(),
}))

vi.mock('$lib/server/billing/admin-spend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/billing/admin-spend')>()
  return {
    ...actual,
    listAdminSpendByUser: listAdminSpendByUserMock,
  }
})

import { load } from './+page.server'

const emptySpend = {
  rows: [],
  totals: {
    totalGatewayCostUsd: '0.000000',
    totalCreditsDebited: 0,
    userCount: 0,
  },
  pagination: {
    page: 1,
    pageSize: 25,
    totalCount: 0,
    totalPages: 1,
    hasPrev: false,
    hasNext: false,
  },
}

describe('admin/spend page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listAdminSpendByUserMock.mockResolvedValue(emptySpend)
  })

  it('auth is enforced by admin layout requireAdmin, not this page load', async () => {
    const result = await load({
      locals: { user: null },
      url: new URL('http://localhost/admin/spend'),
    } as never)

    expect(result.rows).toEqual([])
    expect(result.totals).toEqual(emptySpend.totals)
    expect(result.rangeMode).toBe('last30')
  })

  it('returns empty spend shape without throwing', async () => {
    const result = await load({
      locals: { user: { id: 'admin1' } },
      url: new URL('http://localhost/admin/spend'),
    } as never)

    expect(result.rows).toEqual([])
    expect(result.totals).toEqual(emptySpend.totals)
    expect(result.pagination).toEqual(emptySpend.pagination)
    expect(result.search).toBe('')
    expect(result.sort).toBe('totalGatewayCostUsd')
    expect(result.sortAsc).toBe(false)
    expect(result.rangeMode).toBe('last30')
    expect(result.includeHarness).toBe(false)
    expect(result.from).toEqual(expect.any(String))
    expect(result.to).toEqual(expect.any(String))
    expect(listAdminSpendByUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        includeHarness: false,
        search: undefined,
        page: 1,
        sort: 'totalGatewayCostUsd',
        sortAsc: false,
      }),
    )
  })

  it('uses all-time range when all=1', async () => {
    const result = await load({
      locals: { user: { id: 'admin1' } },
      url: new URL('http://localhost/admin/spend?all=1'),
    } as never)

    expect(result.rangeMode).toBe('all')
    expect(result.from).toBeNull()
    expect(result.to).toBeNull()
    expect(listAdminSpendByUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: null, to: null }),
    )
  })
})
