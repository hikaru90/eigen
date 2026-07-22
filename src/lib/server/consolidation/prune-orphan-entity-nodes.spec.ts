import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, pruneCanonicalEntitiesWithNoThoughtLinksMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  pruneCanonicalEntitiesWithNoThoughtLinksMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
  pruneCanonicalEntitiesWithNoThoughtLinks: pruneCanonicalEntitiesWithNoThoughtLinksMock,
}))

import { pruneOrphanEntityNodesForUser } from './prune-orphan-entity-nodes'

describe('pruneOrphanEntityNodesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pruneCanonicalEntitiesWithNoThoughtLinksMock.mockResolvedValue(0)
  })

  it('returns zero when the tenant has no canonical entities', async () => {
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    })

    await expect(pruneOrphanEntityNodesForUser('u1')).resolves.toEqual({
      graphEntities: 0,
      orphanEntities: 0,
      removed: 0,
    })
    expect(pruneCanonicalEntitiesWithNoThoughtLinksMock).not.toHaveBeenCalled()
  })

  it('prunes entities with no remaining thought links', async () => {
    getDbMock
      .mockReturnValueOnce({
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [{ id: 'e1' }, { id: 'e2' }]),
          })),
        })),
      })
      .mockReturnValueOnce({
        selectDistinct: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(async () => [{ entityId: 'e1' }]),
          })),
        })),
      })
    pruneCanonicalEntitiesWithNoThoughtLinksMock.mockResolvedValue(1)

    await expect(pruneOrphanEntityNodesForUser('u1')).resolves.toEqual({
      graphEntities: 2,
      orphanEntities: 1,
      removed: 1,
    })
    expect(pruneCanonicalEntitiesWithNoThoughtLinksMock).toHaveBeenCalledWith('u1', ['e2'])
  })
})
