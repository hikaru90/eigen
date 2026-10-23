import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ErpNextSyncStatus } from '$lib/server/billing/erpnext-invoice-push'

const {
  listAdminSpendByUserMock,
  listAdminActivityCallsMock,
  resolveAdminUserByQueryMock,
  loadErpNextSyncStatusMock,
} = vi.hoisted(() => ({
  listAdminSpendByUserMock: vi.fn(),
  listAdminActivityCallsMock: vi.fn(),
  resolveAdminUserByQueryMock: vi.fn(),
  loadErpNextSyncStatusMock: vi.fn(),
}))

vi.mock('$lib/server/billing/admin-spend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/billing/admin-spend')>()
  return {
    ...actual,
    listAdminSpendByUser: listAdminSpendByUserMock,
    listAdminActivityCalls: listAdminActivityCallsMock,
    resolveAdminUserByQuery: resolveAdminUserByQueryMock,
  }
})

// The ERPNext sync counters query Postgres directly whenever ERPNEXT_* env is set;
// this spec covers the page load's parsing + delegation and must stay hermetic.
vi.mock('$lib/server/billing/erpnext-invoice-push', () => ({
  loadErpNextSyncStatus: loadErpNextSyncStatusMock,
}))

import { load } from './+page.server'

const erpNextNotConfigured: ErpNextSyncStatus = {
  configured: false,
  uninvoicedCount: 0,
  invoicedCount: 0,
  failedJobCount: 0,
}

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

const emptyCalls = {
  calls: [],
  totals: { callCount: 0, totalCostUsd: '0.000000' },
  pagination: {
    page: 1,
    pageSize: 50,
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
    listAdminActivityCallsMock.mockResolvedValue(emptyCalls)
    resolveAdminUserByQueryMock.mockResolvedValue(null)
    loadErpNextSyncStatusMock.mockResolvedValue(erpNextNotConfigured)
  })

  it('auth is enforced by admin layout requireAdmin, not this page load', async () => {
    const result = await load({
      locals: { user: null },
      url: new URL('http://localhost/admin/spend'),
    } as never)

    expect(result.rows).toEqual([])
    expect(result.totals).toEqual(emptySpend.totals)
    expect(result.rangeMode).toBe('last30')
    expect(result.view).toBe('users')
    expect(result.calls).toEqual([])
  })

  it('returns empty spend shape without throwing', async () => {
    const result = await load({
      locals: { user: { id: 'admin1' } },
      url: new URL('http://localhost/admin/spend'),
    } as never)

    expect(result.rows).toEqual([])
    expect(result.totals).toEqual(emptySpend.totals)
    expect(result.pagination).toEqual(emptySpend.pagination)
    expect(result.erpNext).toEqual(erpNextNotConfigured)
    expect(loadErpNextSyncStatusMock).toHaveBeenCalledTimes(1)
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

  it('loads activity calls when view=calls', async () => {
    resolveAdminUserByQueryMock.mockResolvedValue({
      userId: 'u1',
      email: 'user@example.com',
      name: null,
    })

    const result = await load({
      locals: { user: { id: 'admin1' } },
      url: new URL('http://localhost/admin/spend?view=calls&user=user@example.com&q=enrich&all=1'),
    } as never)

    expect(result.view).toBe('calls')
    expect(result.userFilter?.email).toBe('user@example.com')
    expect(result.calls).toEqual([])
    expect(listAdminActivityCallsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        search: 'enrich',
        from: null,
        to: null,
      }),
    )
    expect(listAdminSpendByUserMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
  })
})
