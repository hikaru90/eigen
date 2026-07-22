import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { getDbMock, spendMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  spendMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/activity/spend-series', () => ({
  loadActivitySpendSeries: spendMock,
}))

describe('POST /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    spendMock.mockResolvedValue({ unit: 'day', buckets: [], totalGroups: 0 })
  })

  function mockEmptyDb() {
    const then = (onFulfilled?: (v: unknown) => unknown) => Promise.resolve([]).then(onFulfilled)
    const groupBy = vi.fn(() => ({
      orderBy: vi.fn(async () => []),
      then,
    }))
    const where = vi.fn(() => ({ groupBy, then, orderBy: vi.fn(async () => []) }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })
  }

  it('returns 401 without session', async () => {
    const res = await POST({
      locals: { user: null },
      request: new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    } as never)
    expect(res.status).toBe(401)
  })

  it('returns empty page when no groups', async () => {
    mockEmptyDb()
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ page: 1 }),
      }),
    } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.calls).toEqual([])
    expect(body.pagination.totalCount).toBe(0)
    expect(spendMock).toHaveBeenCalled()
  })

  it('returns call rows for grouped activity', async () => {
    let selectCall = 0
    const select = vi.fn(() => {
      selectCall += 1
      if (selectCall === 1) {
        const orderBy = vi.fn(async () => [
          { groupId: 'g1', minCreatedAt: new Date('2026-01-01T00:00:00.000Z') },
          { groupId: null, minCreatedAt: '2026-01-01T01:00:00.000Z' },
        ])
        const groupBy = vi.fn(() => ({ orderBy }))
        const where = vi.fn(() => ({ groupBy }))
        const from = vi.fn(() => ({ where }))
        return { from }
      }
      if (selectCall === 2) {
        const orderBy = vi.fn(async () => [
          {
            groupId: 'g1',
            baseCostUsd: '1',
            markupUsd: '0.2',
            totalCostUsd: '1.2',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ])
        const where = vi.fn(() => ({ orderBy }))
        const from = vi.fn(() => ({ where }))
        return { from }
      }
      const then = (onFulfilled?: (v: unknown) => unknown) =>
        Promise.resolve([{ baseCostUsd: '2', markupUsd: '0.4', totalCostUsd: '2.4' }]).then(
          onFulfilled,
        )
      const where = vi.fn(() => ({ then }))
      const from = vi.fn(() => ({ where }))
      return { from }
    })
    getDbMock.mockReturnValue({ select })
    spendMock.mockResolvedValue({ unit: 'day', buckets: [], totalGroups: 2 })

    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-01-02T00:00:00.000Z',
          page: 1,
        }),
      }),
    } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.calls).toHaveLength(1)
    expect(body.totals.totalCostUsd).toBe('1.200000')
    expect(body.pagination.totalCount).toBe(2)
  })

  it('returns 500 on unexpected errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getDbMock.mockImplementation(() => {
      throw new Error('db boom')
    })
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    } as never)
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })
})
