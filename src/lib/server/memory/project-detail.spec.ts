import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadProjectDetail } from './project-detail'

const { listProjectsByEntityIdsMock, listTemporalEventsForUserMock } = vi.hoisted(() => ({
  listProjectsByEntityIdsMock: vi.fn(),
  listTemporalEventsForUserMock: vi.fn(),
}))

vi.mock('./project-list', () => ({
  listProjectsByEntityIds: listProjectsByEntityIdsMock,
}))

vi.mock('./temporal-event-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./temporal-event-list')>()
  return {
    ...actual,
    listTemporalEventsForUser: listTemporalEventsForUserMock,
  }
})

describe('loadProjectDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when the entity is not a listed project', async () => {
    listProjectsByEntityIdsMock.mockResolvedValue([])

    const result = await loadProjectDetail('u1', 'missing')

    expect(result).toBeNull()
    expect(listTemporalEventsForUserMock).not.toHaveBeenCalled()
  })

  it('returns project catalog plus timeline items for that project only', async () => {
    const project = {
      entityId: 'p1',
      label: 'Launch',
      status: 'active' as const,
      source: 'manual' as const,
      nextAction: {
        thoughtId: 't1',
        summary: 'Draft outline',
        itemId: 'task:t1',
      },
      openTaskCount: 2,
      targetDate: '2026-12-01T00:00:00.000Z',
      tasks: [
        { thoughtId: 't1', summary: 'Draft outline', itemId: 'task:t1', rank: 1 },
        { thoughtId: 't2', summary: 'Review', itemId: 'task:t2', rank: 2 },
      ],
      milestones: [
        {
          id: 'm1',
          label: 'Beta',
          targetDate: '2026-10-01T00:00:00.000Z',
          rank: 1,
          completedAt: null,
          linkedThoughtId: null,
        },
      ],
    }
    listProjectsByEntityIdsMock.mockResolvedValue([project])
    listTemporalEventsForUserMock.mockResolvedValue({
      items: [
        {
          id: 'task:t1',
          thoughtId: 't1',
          projectEntityId: 'p1',
          semanticSummary: 'Draft outline',
          lifecycleStatus: 'open',
          thoughtStatus: 'open',
          startAt: '2026-08-01T00:00:00.000Z',
          endAt: null,
        },
        {
          id: 'task:t2',
          thoughtId: 't2',
          projectEntityId: 'p1',
          semanticSummary: 'Review',
          lifecycleStatus: 'completed',
          thoughtStatus: 'completed',
          startAt: null,
          endAt: null,
        },
        {
          id: 'task:other',
          thoughtId: 't9',
          projectEntityId: 'other',
          semanticSummary: 'Other project task',
          lifecycleStatus: 'open',
          thoughtStatus: 'open',
          startAt: null,
          endAt: null,
        },
      ],
      nextCursor: null,
    })

    const result = await loadProjectDetail('u1', 'p1')

    expect(listProjectsByEntityIdsMock).toHaveBeenCalledWith('u1', ['p1'])
    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        status: 'all',
        includeTasks: true,
        range: 'all',
        limit: expect.any(Number),
      }),
    )
    expect(result).toMatchObject({
      project,
      items: [
        expect.objectContaining({ id: 'task:t1', projectEntityId: 'p1' }),
        expect.objectContaining({ id: 'task:t2', projectEntityId: 'p1' }),
      ],
    })
    expect(result?.items).toHaveLength(2)
  })
})
