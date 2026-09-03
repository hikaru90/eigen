import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  extractProjectTimelineMock,
  listProjectsByEntityIdsMock,
  captureThoughtMock,
  linkThoughtToProjectMock,
  orderTaskInProjectMock,
  designateNextActionMock,
  persistProjectTimelineExtractionMock,
  syncTemporalEventsFromThoughtMock,
  getUserPreferredTimezoneMock,
} = vi.hoisted(() => ({
  extractProjectTimelineMock: vi.fn(),
  listProjectsByEntityIdsMock: vi.fn(),
  captureThoughtMock: vi.fn(),
  linkThoughtToProjectMock: vi.fn(),
  orderTaskInProjectMock: vi.fn(),
  designateNextActionMock: vi.fn(),
  persistProjectTimelineExtractionMock: vi.fn(),
  syncTemporalEventsFromThoughtMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(),
}))

vi.mock('$lib/server/memory/extract-project-timeline', () => ({
  extractProjectTimeline: extractProjectTimelineMock,
}))

vi.mock('$lib/server/memory/project-list', () => ({
  listProjectsByEntityIds: listProjectsByEntityIdsMock,
}))

vi.mock('$lib/server/capture/service', () => ({
  captureThought: captureThoughtMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkThoughtToProjectMock,
  designateNextAction: designateNextActionMock,
}))

vi.mock('$lib/server/memory/project-task-sequence', () => ({
  orderTaskInProject: orderTaskInProjectMock,
}))

vi.mock('$lib/server/memory/project-timeline', () => ({
  persistProjectTimelineExtraction: persistProjectTimelineExtractionMock,
  loadLinkedThoughtSummariesForProject: vi.fn(async () => [
    { thoughtId: 'existing', summary: 'Existing note' },
  ]),
  loadExistingDeadlinesForProject: vi.fn(async () => []),
}))

vi.mock('$lib/server/memory/temporal-graph-sync', () => ({
  syncTemporalEventsFromThought: syncTemporalEventsFromThoughtMock,
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
  }),
}))

vi.mock('$lib/server/ontology-db', () => ({
  ensureUserOntologySeeded: vi.fn(async () => undefined),
  loadOntologyForUser: vi.fn(async () => ({
    entityKindsByKey: new Map([['task', { id: 'kind-task' }]]),
  })),
}))

import { generateProjectPlan } from './generate-project-plan'

describe('generateProjectPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserPreferredTimezoneMock.mockResolvedValue('UTC')
    listProjectsByEntityIdsMock.mockResolvedValue([
      {
        entityId: 'p1',
        label: 'Launch',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 0,
        targetDate: null,
        tasks: [],
        milestones: [],
      },
    ])
    extractProjectTimelineMock.mockResolvedValue({
      targetDate: '2026-12-01T00:00:00.000Z',
      milestones: [
        { label: 'Beta', targetDate: '2026-10-01T00:00:00.000Z', linkedThoughtId: null },
      ],
      tasks: [
        {
          summary: 'Draft outline',
          kind: 'deadline',
          suggestedStartAt: '2026-08-01T00:00:00.000Z',
          suggestedEndAt: '2026-08-02T00:00:00.000Z',
          isNextAction: true,
        },
        {
          summary: 'Review with design',
          kind: 'deadline',
          suggestedStartAt: null,
          suggestedEndAt: null,
          isNextAction: false,
        },
      ],
    })
    captureThoughtMock
      .mockResolvedValueOnce({ id: 't-new-1', thoughtId: 't-new-1' })
      .mockResolvedValueOnce({ id: 't-new-2', thoughtId: 't-new-2' })
    orderTaskInProjectMock.mockImplementation(async (input: { thoughtId: string }) => ({
      projectEntityId: 'p1',
      orderedThoughtIds: ['t-new-1', 't-new-2'].filter(
        (id) => id === input.thoughtId || id === 't-new-1',
      ),
    }))
    linkThoughtToProjectMock.mockResolvedValue(undefined)
    designateNextActionMock.mockResolvedValue(undefined)
    persistProjectTimelineExtractionMock.mockResolvedValue(undefined)
    syncTemporalEventsFromThoughtMock.mockResolvedValue(undefined)
  })

  it('throws when project is missing', async () => {
    listProjectsByEntityIdsMock.mockResolvedValue([])
    await expect(generateProjectPlan({ userId: 'u1', projectEntityId: 'missing' })).rejects.toThrow(
      /not found/i,
    )
  })

  it('captures tasks, links them, orders waterfall, writes temporal events, and persists milestones', async () => {
    const result = await generateProjectPlan({
      userId: 'u1',
      projectEntityId: 'p1',
      goal: 'Ship beta by October',
    })

    expect(extractProjectTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        projectLabel: 'Launch',
        goal: 'Ship beta by October',
      }),
    )
    expect(captureThoughtMock).toHaveBeenCalledTimes(2)
    expect(captureThoughtMock).toHaveBeenNthCalledWith(
      1,
      'u1',
      'Draft outline',
      expect.objectContaining({ source: 'api' }),
    )
    expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't-new-1', 'manual')
    expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't-new-2', 'manual')
    expect(orderTaskInProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ thoughtId: 't-new-1', rank: 1 }),
    )
    expect(orderTaskInProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ thoughtId: 't-new-2', rank: 2 }),
    )
    expect(designateNextActionMock).toHaveBeenCalledWith('u1', 'p1', 't-new-1')
    expect(syncTemporalEventsFromThoughtMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        thoughtId: 't-new-1',
        precomputedMentions: expect.arrayContaining([
          expect.objectContaining({
            kind: 'deadline',
            startAt: '2026-08-01T00:00:00.000Z',
          }),
        ]),
      }),
    )
    expect(persistProjectTimelineExtractionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        projectEntityId: 'p1',
        extraction: expect.objectContaining({
          targetDate: '2026-12-01T00:00:00.000Z',
          milestones: expect.arrayContaining([expect.objectContaining({ label: 'Beta' })]),
        }),
      }),
    )
    expect(result.tasks).toHaveLength(2)
    expect(result.tasks[0]).toMatchObject({ thoughtId: 't-new-1', rank: 1, isNextAction: true })
    expect(result.targetDate).toBe('2026-12-01T00:00:00.000Z')
    expect(result.milestones).toHaveLength(1)
  })
})
