import { beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertGraphHubEntity } from './project-entity'

const { getDbMock, upsertNodeMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  upsertNodeMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  upsertEntityNode: upsertNodeMock,
}))

vi.mock('$lib/server/memory/project-eligibility', () => ({
  loadProjectEntityRow: vi.fn(),
}))

describe('upsertGraphHubEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertNodeMock.mockResolvedValue(undefined)
  })

  it('rejects blank names', async () => {
    await expect(upsertGraphHubEntity('u1', '  ')).rejects.toThrow(/name is required/)
  })

  it('returns existing id and updates label', async () => {
    const limit = vi.fn(async () => [{ id: 'e1', entityType: 'organization' }])
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const update = vi.fn(() => ({ set: updateSet }))
    getDbMock.mockReturnValue({ select, update })

    await expect(upsertGraphHubEntity('u1', 'Eigen')).resolves.toBe('e1')
    expect(upsertNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1', label: 'Eigen' }),
    )
  })

  it('inserts a new hub when none exists', async () => {
    const limit = vi.fn(async () => [])
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    const returning = vi.fn(async () => [{ id: 'e2' }])
    const values = vi.fn(() => ({ returning }))
    const insert = vi.fn(() => ({ values }))
    getDbMock.mockReturnValue({ select, insert })

    await expect(upsertGraphHubEntity('u1', 'New Hub')).resolves.toBe('e2')
    expect(insert).toHaveBeenCalled()
  })
})
