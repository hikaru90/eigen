import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createAdminSqlMock, sqlEndMock } = vi.hoisted(() => ({
  createAdminSqlMock: vi.fn(),
  sqlEndMock: vi.fn(),
}))

vi.mock('$lib/server/job-queue/admin-db', () => ({
  createAdminSql: createAdminSqlMock,
}))

import { computeAdminSpendTotals, listAdminSpendByUser, mapAdminSpendDbRow } from './admin-spend'

describe('admin-spend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('mapAdminSpendDbRow normalizes gateway USD and billing mode', () => {
    const row = mapAdminSpendDbRow({
      user_id: 'u1',
      email: 'a@example.com',
      name: 'Alex',
      account_kind: 'production',
      billing_mode: 'byok',
      available_credits: 500,
      total_gateway_cost_usd: '1.5',
      total_credits_debited: '1500',
      last_activity_at: new Date('2026-01-15T12:00:00Z'),
    })

    expect(row).toEqual({
      userId: 'u1',
      email: 'a@example.com',
      name: 'Alex',
      accountKind: 'production',
      billingMode: 'byok',
      availableCredits: 500,
      totalGatewayCostUsd: '1.500000',
      totalCreditsDebited: 1500,
      lastActivityAt: new Date('2026-01-15T12:00:00Z'),
    })
  })

  it('mapAdminSpendDbRow defaults unknown billing mode to platform_credits', () => {
    const row = mapAdminSpendDbRow({
      user_id: 'u2',
      email: 'b@example.com',
      name: null,
      account_kind: null,
      billing_mode: null,
      available_credits: null,
      total_gateway_cost_usd: null,
      total_credits_debited: null,
      last_activity_at: null,
    })

    expect(row.billingMode).toBe('platform_credits')
    expect(row.availableCredits).toBe(0)
    expect(row.totalGatewayCostUsd).toBe('0.000000')
    expect(row.totalCreditsDebited).toBe(0)
  })

  it('computeAdminSpendTotals sums rows', () => {
    const totals = computeAdminSpendTotals([
      {
        userId: 'u1',
        email: 'a@example.com',
        name: null,
        accountKind: 'production',
        billingMode: 'platform_credits',
        availableCredits: 100,
        totalGatewayCostUsd: '2.000000',
        totalCreditsDebited: 2000,
        lastActivityAt: null,
      },
      {
        userId: 'u2',
        email: 'b@example.com',
        name: null,
        accountKind: 'production',
        billingMode: 'byok',
        availableCredits: 0,
        totalGatewayCostUsd: '0.500000',
        totalCreditsDebited: 0,
        lastActivityAt: null,
      },
    ])

    expect(totals).toEqual({
      totalGatewayCostUsd: '2.500000',
      totalCreditsDebited: 2000,
      userCount: 2,
    })
  })

  it('listAdminSpendByUser maps SQL rows with pagination', async () => {
    const queryMock = vi.fn(async (strings: TemplateStringsArray) => {
      const sqlText = strings.join(' ')
      if (sqlText.includes('COUNT(*)')) {
        return [
          {
            user_count: 1,
            total_gateway_cost_usd: '3',
            total_credits_debited: '3000',
          },
        ]
      }
      if (sqlText.includes('AS user_id')) {
        return [
          {
            user_id: 'u1',
            email: 'a@example.com',
            name: 'Alex',
            account_kind: 'production',
            billing_mode: 'platform_credits',
            available_credits: 1000,
            total_gateway_cost_usd: '3',
            total_credits_debited: '3000',
            last_activity_at: new Date('2026-02-01T00:00:00Z'),
          },
        ]
      }
      return []
    })
    createAdminSqlMock.mockReturnValue(Object.assign(queryMock, { end: sqlEndMock }))

    const result = await listAdminSpendByUser({ from: null, to: null })

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.totalGatewayCostUsd).toBe('3.000000')
    expect(result.totals.userCount).toBe(1)
    expect(result.pagination).toEqual({
      page: 1,
      pageSize: 25,
      totalCount: 1,
      totalPages: 1,
      hasPrev: false,
      hasNext: false,
    })
    expect(sqlEndMock).toHaveBeenCalledOnce()
  })
})
