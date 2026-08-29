import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  countOpenTasksForProjectEntity,
  demoteProject,
  ensureProject,
  loadOpenTaskThoughtsForProjectEntity,
  pickHigherProjectSource,
  restoreProjectListing,
} from './project-eligibility'

const { getDbMock, updateSetMock, selectLimitMock, selectOrderByMock } = vi.hoisted(() => {
  const updateWhereMock = vi.fn()
  return {
    getDbMock: vi.fn(),
    updateSetMock: vi.fn(() => ({ where: updateWhereMock })),
    selectLimitMock: vi.fn(),
    selectOrderByMock: vi.fn(async () => []),
  }
})

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  upsertEntityNode: vi.fn(async () => undefined),
}))

function openTaskRow(input: {
  thoughtId: string
  createdAt: string
  status?: 'open' | 'completed'
  lifecycleStatus?: 'open' | 'completed' | 'archived'
}) {
  return {
    thoughtId: input.thoughtId,
    createdAt: new Date(input.createdAt),
    metadata: { status: input.status ?? 'open' },
    metadataEncrypted: null,
    lifecycleStatus: input.lifecycleStatus ?? 'open',
  }
}

describe('project-eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectOrderByMock.mockResolvedValue([])
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: selectLimitMock,
          })),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: selectOrderByMock,
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: updateSetMock,
      })),
    })
  })

  it('pickHigherProjectSource never downgrades manual provenance', () => {
    expect(pickHigherProjectSource('manual', 'capture')).toBe('manual')
    expect(pickHigherProjectSource('grounding', 'capture')).toBe('grounding')
    expect(pickHigherProjectSource('capture', 'manual')).toBe('manual')
  })

  it('demoteProject is a no-op for manual projects', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'p1',
        label: 'Hydra',
        canonicalKey: 'hydra',
        entityType: 'project',
        projectStatus: 'active',
        projectSource: 'manual',
      },
    ])

    const didDemote = await demoteProject('u1', 'p1')
    expect(didDemote).toBe(false)
    expect(updateSetMock).not.toHaveBeenCalled()
  })

  it('ensureProject keeps manual source when capture path re-upserts', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'p1',
        label: 'Hydra',
        canonicalKey: 'hydra',
        entityType: 'project',
        projectStatus: 'active',
        projectSource: 'manual',
      },
    ])

    await ensureProject('u1', 'p1', 'active', 'capture')
    expect(updateSetMock).toHaveBeenCalled()
    const setArg = updateSetMock.mock.calls[0]?.[0]
    expect(setArg?.projectSource).toBe('manual')
  })

  it('restoreProjectListing re-lists a demoted capture project', async () => {
    selectLimitMock.mockResolvedValueOnce([
      {
        id: 'p1',
        label: 'Eigen',
        canonicalKey: 'eigen',
        entityType: 'organization',
        projectStatus: null,
        projectSource: null,
      },
    ])

    await restoreProjectListing('u1', 'p1', 'active', 'capture')
    expect(updateSetMock).toHaveBeenCalled()
    const setArg = updateSetMock.mock.calls[0]?.[0]
    expect(setArg?.projectStatus).toBe('active')
    expect(setArg?.entityType).toBe('project')
  })
})

describe('loadOpenTaskThoughtsForProjectEntity', () => {
  it('keeps only open task thoughts, in the order the DB returns (createdAt ASC)', async () => {
    selectOrderByMock.mockResolvedValue([
      openTaskRow({ thoughtId: 't-old', createdAt: '2026-01-01T00:00:00.000Z' }),
      openTaskRow({ thoughtId: 't-new', createdAt: '2026-02-01T00:00:00.000Z' }),
      openTaskRow({
        thoughtId: 't-done',
        createdAt: '2025-12-01T00:00:00.000Z',
        status: 'completed',
      }),
      openTaskRow({
        thoughtId: 't-archived',
        createdAt: '2025-11-01T00:00:00.000Z',
        lifecycleStatus: 'archived',
      }),
      openTaskRow({
        thoughtId: 't-completed-lifecycle',
        createdAt: '2025-10-01T00:00:00.000Z',
        lifecycleStatus: 'completed',
      }),
    ])

    const open = await loadOpenTaskThoughtsForProjectEntity('u1', 'p1')

    expect(open.map((task) => task.thoughtId)).toEqual(['t-old', 't-new'])
    // Ordering is delegated to SQL (createdAt ASC), not re-sorted in memory.
    expect(selectOrderByMock).toHaveBeenCalledTimes(1)
  })

  it('returns createdAt so callers can order unsequenced tasks', async () => {
    selectOrderByMock.mockResolvedValue([
      openTaskRow({ thoughtId: 't1', createdAt: '2026-03-04T05:06:07.000Z' }),
    ])

    const open = await loadOpenTaskThoughtsForProjectEntity('u1', 'p1')

    expect(open[0]?.createdAt.toISOString()).toBe('2026-03-04T05:06:07.000Z')
  })

  it('is the single source of truth behind countOpenTasksForProjectEntity', async () => {
    selectOrderByMock.mockResolvedValue([
      openTaskRow({ thoughtId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      openTaskRow({ thoughtId: 't2', createdAt: '2026-01-02T00:00:00.000Z' }),
      openTaskRow({
        thoughtId: 't3',
        createdAt: '2026-01-03T00:00:00.000Z',
        lifecycleStatus: 'archived',
      }),
      openTaskRow({
        thoughtId: 't4',
        createdAt: '2026-01-04T00:00:00.000Z',
        status: 'completed',
      }),
    ])

    const open = await loadOpenTaskThoughtsForProjectEntity('u1', 'p1')
    selectOrderByMock.mockResolvedValue([
      openTaskRow({ thoughtId: 't1', createdAt: '2026-01-01T00:00:00.000Z' }),
      openTaskRow({ thoughtId: 't2', createdAt: '2026-01-02T00:00:00.000Z' }),
      openTaskRow({
        thoughtId: 't3',
        createdAt: '2026-01-03T00:00:00.000Z',
        lifecycleStatus: 'archived',
      }),
      openTaskRow({
        thoughtId: 't4',
        createdAt: '2026-01-04T00:00:00.000Z',
        status: 'completed',
      }),
    ])
    const count = await countOpenTasksForProjectEntity('u1', 'p1')

    expect(count).toBe(open.length)
    expect(count).toBe(2)
  })
})
