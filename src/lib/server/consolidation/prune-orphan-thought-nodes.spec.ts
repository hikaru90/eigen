import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, fetchThoughtNodeIdsForUserMock, deleteThoughtVertexFromGraphMock } = vi.hoisted(
  () => ({
    getDbMock: vi.fn(),
    fetchThoughtNodeIdsForUserMock: vi.fn(),
    deleteThoughtVertexFromGraphMock: vi.fn(),
  }),
)

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/graph/age', () => ({
  fetchThoughtNodeIdsForUser: fetchThoughtNodeIdsForUserMock,
  deleteThoughtVertexFromGraph: deleteThoughtVertexFromGraphMock,
}))

import { pruneOrphanThoughtNodesForUser } from './prune-orphan-thought-nodes'

describe('pruneOrphanThoughtNodesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteThoughtVertexFromGraphMock.mockResolvedValue(undefined)
  })

  it('removes graph thought nodes missing from Postgres', async () => {
    fetchThoughtNodeIdsForUserMock.mockResolvedValue([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ id: '11111111-1111-4111-8111-111111111111' }]),
        })),
      })),
    })

    const result = await pruneOrphanThoughtNodesForUser('u1')

    expect(result).toEqual({ graphThoughts: 2, orphanThoughts: 1, removed: 1 })
    expect(deleteThoughtVertexFromGraphMock).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('treats invalid thought ids as orphan nodes', async () => {
    fetchThoughtNodeIdsForUserMock.mockResolvedValue(['not-a-uuid'])
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    })

    const result = await pruneOrphanThoughtNodesForUser('u1')

    expect(result).toEqual({ graphThoughts: 1, orphanThoughts: 1, removed: 1 })
    expect(deleteThoughtVertexFromGraphMock).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 'not-a-uuid',
    })
  })
})
