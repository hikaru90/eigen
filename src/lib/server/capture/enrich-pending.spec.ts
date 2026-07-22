import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPendingEnrichThoughtIds } from './enrich-pending'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

describe('listPendingEnrichThoughtIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns thought ids with pending/processing enrich status', async () => {
    const where = vi.fn(async () => [{ id: 't1' }, { id: 't2' }])
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })

    await expect(listPendingEnrichThoughtIds('u1')).resolves.toEqual(['t1', 't2'])
    expect(select).toHaveBeenCalled()
  })

  it('returns empty array when none pending', async () => {
    const where = vi.fn(async () => [])
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })

    await expect(listPendingEnrichThoughtIds('u1')).resolves.toEqual([])
  })
})
