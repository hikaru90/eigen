import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNextActionIfCompleted, designateNextAction } from './project-next-action'

const {
  getDbMock,
  upsertMentionEdgeMock,
  loadOrderedThoughtIdsForProjectMock,
  loadOpenTaskThoughtIdsForProjectMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  upsertMentionEdgeMock: vi.fn(async () => undefined),
  loadOrderedThoughtIdsForProjectMock: vi.fn(async () => [] as string[]),
  loadOpenTaskThoughtIdsForProjectMock: vi.fn(async () => new Set<string>()),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  upsertMentionEdge: upsertMentionEdgeMock,
}))

vi.mock('./project-task-sequence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-task-sequence')>()
  return {
    ...actual,
    loadOrderedThoughtIdsForProject: loadOrderedThoughtIdsForProjectMock,
    loadOpenTaskThoughtIdsForProject: loadOpenTaskThoughtIdsForProjectMock,
  }
})

function makeLimitChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  }
  return chain
}

describe('project-next-action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadOrderedThoughtIdsForProjectMock.mockResolvedValue([])
    loadOpenTaskThoughtIdsForProjectMock.mockResolvedValue(new Set())
  })

  it('designateNextAction links thought to GTD project entity', async () => {
    const updateWhereMock = vi.fn(async () => undefined)
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue(makeLimitChain([{ id: 'project-1' }])),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn(async () => undefined),
          onConflictDoUpdate: vi.fn(async () => undefined),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhereMock })),
      })),
    })

    await designateNextAction('u1', 'project-1', 'thought-1')
    expect(upsertMentionEdgeMock).toHaveBeenCalledWith({
      userId: 'u1',
      thoughtId: 'thought-1',
      entityId: 'project-1',
    })
    expect(updateWhereMock).toHaveBeenCalled()
  })

  it('clearNextActionIfCompleted clears matching entity row when no sequence', async () => {
    const setMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ id: 'project-1' }]),
        })),
      }),
      update: vi.fn(() => ({ set: setMock })),
    })

    await clearNextActionIfCompleted('u1', 'thought-1')
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ nextActionThoughtId: null, projectDesignatedAt: null }),
    )
  })

  it('clearNextActionIfCompleted advances to next open sequenced task', async () => {
    const setMock = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
    getDbMock.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ id: 'project-1' }]),
        })),
      }),
      update: vi.fn(() => ({ set: setMock })),
    })
    loadOrderedThoughtIdsForProjectMock.mockResolvedValue(['thought-1', 'thought-2'])
    loadOpenTaskThoughtIdsForProjectMock.mockResolvedValue(new Set(['thought-2']))

    await clearNextActionIfCompleted('u1', 'thought-1')
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({ nextActionThoughtId: 'thought-2' }),
    )
  })
})
