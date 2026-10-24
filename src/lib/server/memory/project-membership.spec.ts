import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

import {
  findGtdProjectForUser,
  thoughtHasProjectMembership,
} from './project-membership'

function selectReturning(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const innerJoin = vi.fn(() => ({ where }))
  const from = vi.fn(() => ({ where, innerJoin }))
  getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })
  return { from, innerJoin, where, limit }
}

describe('project-membership queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('thoughtHasProjectMembership is true only when a membership row sits on a GTD project', async () => {
    selectReturning([{ entityId: 'p1' }])
    await expect(thoughtHasProjectMembership('u1', 't1')).resolves.toBe(true)

    selectReturning([])
    await expect(thoughtHasProjectMembership('u1', 't1')).resolves.toBe(false)
  })

  it('thoughtHasProjectMembership rejects an empty thoughtId at the boundary', async () => {
    await expect(thoughtHasProjectMembership('u1', '   ')).rejects.toThrow(/thoughtId/)
  })

  it('findGtdProjectForUser returns the project the user picked', async () => {
    selectReturning([{ id: 'p1', label: 'EigenMesh' }])
    await expect(findGtdProjectForUser('u1', 'p1')).resolves.toEqual({
      entityId: 'p1',
      label: 'EigenMesh',
    })
  })

  it('findGtdProjectForUser returns null when the entity is missing or not a project', async () => {
    selectReturning([])
    await expect(findGtdProjectForUser('u1', 'gone')).resolves.toBeNull()
  })

  it('findGtdProjectForUser rejects an empty entityId at the boundary', async () => {
    await expect(findGtdProjectForUser('u1', '')).rejects.toThrow(/projectEntityId/)
  })
})
