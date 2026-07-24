import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listProjectsByEntityIdsMock,
  setThoughtLifecycleStatusMock,
  clearNextActionIfCompletedMock,
  replaceProjectTaskSequenceMock,
  setProjectDeadlineMock,
  syncTemporalEventsFromThoughtMock,
  captureThoughtMock,
  linkThoughtToProjectMock,
  orderTaskInProjectMock,
  designateNextActionMock,
  getUserPreferredTimezoneMock,
} = vi.hoisted(() => ({
  listProjectsByEntityIdsMock: vi.fn(),
  setThoughtLifecycleStatusMock: vi.fn(),
  clearNextActionIfCompletedMock: vi.fn(),
  replaceProjectTaskSequenceMock: vi.fn(),
  setProjectDeadlineMock: vi.fn(),
  syncTemporalEventsFromThoughtMock: vi.fn(),
  captureThoughtMock: vi.fn(),
  linkThoughtToProjectMock: vi.fn(),
  orderTaskInProjectMock: vi.fn(),
  designateNextActionMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(),
}))

vi.mock('$lib/server/memory/project-list', () => ({
  listProjectsByEntityIds: listProjectsByEntityIdsMock,
}))

vi.mock('$lib/server/memory/lifecycle', () => ({
  setThoughtLifecycleStatus: setThoughtLifecycleStatusMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  clearNextActionIfCompleted: clearNextActionIfCompletedMock,
  linkThoughtToProject: linkThoughtToProjectMock,
  designateNextAction: designateNextActionMock,
}))

vi.mock('$lib/server/memory/project-task-sequence', () => ({
  replaceProjectTaskSequence: replaceProjectTaskSequenceMock,
  orderTaskInProject: orderTaskInProjectMock,
}))

vi.mock('$lib/server/memory/project-timeline', () => ({
  setProjectDeadline: setProjectDeadlineMock,
}))

vi.mock('$lib/server/memory/temporal-graph-sync', () => ({
  syncTemporalEventsFromThought: syncTemporalEventsFromThoughtMock,
}))

vi.mock('$lib/server/capture/service', () => ({
  captureThought: captureThoughtMock,
}))

vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: getUserPreferredTimezoneMock,
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: vi.fn(async () => undefined),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: vi.fn(async () => [{ id: 'kind-task' }]),
        }),
      }),
    }),
  }),
}))

vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: vi.fn(async () => undefined),
  loadOntologyForUser: vi.fn(async () => ({
    entityKindsByKey: new Map([['task', { id: 'kind-task' }]]),
  })),
}))

import { applyProjectReview, type ApplyProjectReviewInput } from './project-review'

describe('applyProjectReview', () => {
  const baseApply: ApplyProjectReviewInput = {
    userId: 'u1',
    projectEntityId: 'p1',
    markDone: [],
    archive: [],
    deadlines: [],
    order: ['t1', 't2'],
    projectDeadline: null,
    newTasks: [],
    nextActionThoughtId: 't1',
    nextActionNewTaskIndex: null,
    allowedThoughtIds: ['t1', 't2'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    listProjectsByEntityIdsMock.mockResolvedValue([
      {
        entityId: 'p1',
        label: 'Launch',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 2,
        targetDate: null,
        tasks: [
          { thoughtId: 't1', summary: 'Draft', itemId: 'task:t1', rank: 1 },
          { thoughtId: 't2', summary: 'Review', itemId: 'task:t2', rank: 2 },
        ],
        milestones: [],
      },
    ])
    setThoughtLifecycleStatusMock.mockResolvedValue({ ok: true, kind: 'thought', thought: {} })
    clearNextActionIfCompletedMock.mockResolvedValue(undefined)
    replaceProjectTaskSequenceMock.mockResolvedValue(undefined)
    setProjectDeadlineMock.mockResolvedValue({ projectEntityId: 'p1', targetDate: null })
    syncTemporalEventsFromThoughtMock.mockResolvedValue(undefined)
    captureThoughtMock.mockResolvedValue({ id: 't-new-1' })
    linkThoughtToProjectMock.mockResolvedValue(undefined)
    orderTaskInProjectMock.mockResolvedValue({
      projectEntityId: 'p1',
      orderedThoughtIds: ['t1', 't2', 't-new-1'],
    })
    designateNextActionMock.mockResolvedValue(undefined)
    getUserPreferredTimezoneMock.mockResolvedValue('UTC')
  })

  it('throws when project is missing', async () => {
    listProjectsByEntityIdsMock.mockResolvedValue([])
    await expect(applyProjectReview(baseApply)).rejects.toThrow(/not found/i)
  })

  it('applies only the accepted subset and never creates unconfirmed new tasks', async () => {
    await applyProjectReview({
      ...baseApply,
      markDone: ['t2'],
      archive: [],
      deadlines: [{ thoughtId: 't1', targetDate: '2026-08-01T00:00:00.000Z' }],
      order: ['t1'],
      projectDeadline: '2026-12-01T00:00:00.000Z',
      newTasks: [],
      nextActionThoughtId: 't1',
    })

    expect(setThoughtLifecycleStatusMock).toHaveBeenCalledWith('u1', 't2', 'completed')
    expect(captureThoughtMock).not.toHaveBeenCalled()
    expect(setProjectDeadlineMock).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      targetDate: '2026-12-01T00:00:00.000Z',
    })
    expect(replaceProjectTaskSequenceMock).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      orderedThoughtIds: ['t1'],
    })
    expect(designateNextActionMock).toHaveBeenCalledWith('u1', 'p1', 't1')
    expect(syncTemporalEventsFromThoughtMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        thoughtId: 't1',
        precomputedMentions: expect.arrayContaining([
          expect.objectContaining({
            kind: 'deadline',
            startAt: '2026-08-01T00:00:00.000Z',
          }),
        ]),
      }),
    )
  })

  it('rejects invented thought ids in markDone / archive / deadlines / order / nextAction', async () => {
    await expect(
      applyProjectReview({
        ...baseApply,
        markDone: ['foreign'],
        allowedThoughtIds: ['t1', 't2'],
      }),
    ).rejects.toThrow(/unknown thought/i)

    await expect(
      applyProjectReview({
        ...baseApply,
        archive: ['foreign'],
      }),
    ).rejects.toThrow(/unknown thought/i)

    await expect(
      applyProjectReview({
        ...baseApply,
        deadlines: [{ thoughtId: 'foreign', targetDate: '2026-08-01T00:00:00.000Z' }],
      }),
    ).rejects.toThrow(/unknown thought/i)

    await expect(
      applyProjectReview({
        ...baseApply,
        order: ['t1', 'foreign'],
      }),
    ).rejects.toThrow(/unknown thought/i)

    await expect(
      applyProjectReview({
        ...baseApply,
        nextActionThoughtId: 'foreign',
      }),
    ).rejects.toThrow(/unknown thought/i)

    expect(setThoughtLifecycleStatusMock).not.toHaveBeenCalled()
    expect(captureThoughtMock).not.toHaveBeenCalled()
  })

  it('creates only confirmed new tasks and can designate next action from a new task', async () => {
    const result = await applyProjectReview({
      ...baseApply,
      newTasks: [
        {
          summary: 'Book venue',
          kind: 'deadline',
          suggestedStartAt: '2026-09-01T00:00:00.000Z',
          suggestedEndAt: null,
        },
      ],
      nextActionThoughtId: null,
      nextActionNewTaskIndex: 0,
    })

    expect(captureThoughtMock).toHaveBeenCalledTimes(1)
    expect(captureThoughtMock).toHaveBeenCalledWith(
      'u1',
      'Book venue',
      expect.objectContaining({ source: 'api' }),
    )
    expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't-new-1', 'manual')
    expect(designateNextActionMock).toHaveBeenCalledWith('u1', 'p1', 't-new-1')
    expect(result.createdThoughtIds).toEqual(['t-new-1'])
  })

  it('archives accepted tasks via lifecycle archived and clears next-action', async () => {
    await applyProjectReview({
      ...baseApply,
      archive: ['t2'],
      nextActionThoughtId: 't1',
    })
    expect(setThoughtLifecycleStatusMock).toHaveBeenCalledWith('u1', 't2', 'archived')
    expect(clearNextActionIfCompletedMock).toHaveBeenCalledWith('u1', 't2')
  })
})
