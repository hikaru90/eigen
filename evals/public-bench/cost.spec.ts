import { describe, expect, it, vi } from 'vitest'

vi.mock('../harness/eval-context', () => ({ withEvalDb: vi.fn() }))

import { aggregateRunCost } from './cost'

const row = (operation: string, totalCostUsd: string, durationMs: number | null = 100) => ({
  operation,
  baseCostUsd: totalCostUsd,
  markupUsd: '0',
  totalCostUsd,
  durationMs,
})

const window = { from: new Date('2026-10-25T10:00:00Z'), to: new Date('2026-10-25T12:00:00Z') }

describe('aggregateRunCost', () => {
  it('sums USD across tenants and reports a per-tenant split', async () => {
    const loadRows = vi.fn(async (tenant: string) =>
      tenant === 't1'
        ? [row('enrich', '0.001000'), row('answer', '0.002000')]
        : [row('enrich', '0.004000', null)],
    )
    const out = await aggregateRunCost({ tenantUserIds: ['t1', 't2'], ...window, loadRows })

    expect(out.totalUsd).toBe('0.007000')
    expect(out.callCount).toBe(3)
    expect(out.byOperation.enrich).toEqual({ count: 2, totalUsd: '0.005000', totalMs: 100 })
    expect(out.byTenantUsd).toEqual({ t1: '0.003000', t2: '0.004000' })
  })

  it('passes the tenant and the window to the loader', async () => {
    const loadRows = vi.fn(async () => [])
    await aggregateRunCost({ tenantUserIds: ['t1'], ...window, loadRows })
    expect(loadRows).toHaveBeenCalledWith('t1', window.from, window.to)
  })

  it('reports zero for tenants with no activity', async () => {
    const out = await aggregateRunCost({
      tenantUserIds: ['t1'],
      ...window,
      loadRows: async () => [],
    })
    expect(out.totalUsd).toBe('0.000000')
    expect(out.byTenantUsd).toEqual({ t1: '0.000000' })
  })

  it('counts a duplicated tenant id once', async () => {
    const loadRows = vi.fn(async () => [row('enrich', '0.001000')])
    const out = await aggregateRunCost({ tenantUserIds: ['t1', 't1'], ...window, loadRows })
    expect(loadRows).toHaveBeenCalledTimes(1)
    expect(out.totalUsd).toBe('0.001000')
  })

  it('rejects no tenants, a blank tenant, or an inverted window', async () => {
    const loadRows = async () => []
    await expect(aggregateRunCost({ tenantUserIds: [], ...window, loadRows })).rejects.toThrow(
      /tenantUserIds/,
    )
    await expect(aggregateRunCost({ tenantUserIds: [' '], ...window, loadRows })).rejects.toThrow(
      /tenantUserIds/,
    )
    await expect(
      aggregateRunCost({ tenantUserIds: ['t1'], from: window.to, to: window.from, loadRows }),
    ).rejects.toThrow(/window/)
    await expect(
      aggregateRunCost({
        tenantUserIds: ['t1'],
        from: new Date('invalid'),
        to: window.to,
        loadRows,
      }),
    ).rejects.toThrow(/window/)
  })
})
