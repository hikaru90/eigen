import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_LIST_LIMIT } from '$lib/server/memory/temporal-event-list'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import type { ProjectListItem } from '$lib/server/memory/project-list'

const { listTemporalEventsForUserMock, listProjectsByEntityIdsMock } = vi.hoisted(() => ({
  listTemporalEventsForUserMock: vi.fn(),
  listProjectsByEntityIdsMock: vi.fn(),
}))

vi.mock('$lib/server/memory/temporal-event-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./temporal-event-list')>()
  return {
    ...actual,
    listTemporalEventsForUser: listTemporalEventsForUserMock,
  }
})

vi.mock('$lib/server/memory/project-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-list')>()
  return {
    ...actual,
    listProjectsByEntityIds: listProjectsByEntityIdsMock,
  }
})

import { loadUnifiedTimeline } from './timeline-unified'

function makeItem(
  overrides: Partial<TemporalEventListItem> & Pick<TemporalEventListItem, 'id'>,
): TemporalEventListItem {
  return {
    itemType: 'task',
    kind: 'deadline',
    semanticSummary: 'Task',
    sourceTextSpan: null,
    timePrecision: 'day',
    timezone: 'UTC',
    isAllDay: true,
    confidence: 1,
    startAt: null,
    endAt: null,
    activePeriod: '',
    graphSyncStatus: 'synced',
    graphSyncError: null,
    lifecycleStatus: 'open',
    snoozedUntil: null,
    recurrenceRule: null,
    durationMinutes: null,
    energyLevel: null,
    priorityQuadrant: null,
    contextTags: [],
    focusRank: null,
    parentEventId: null,
    thoughtId: `th-${overrides.id}`,
    thoughtText: 'Task',
    thoughtCategory: 'task',
    thoughtStatus: 'open',
    memoryType: null,
    projectLabel: null,
    projectEntityId: null,
    completedAt: null,
    lifecycleUpdatedAt: null,
    createdAt: '2026-07-20T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('loadUnifiedTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listTemporalEventsForUserMock.mockResolvedValue({ items: [], nextCursor: null })
    listProjectsByEntityIdsMock.mockResolvedValue([])
  })

  it('returns the full item set with no nextCursor in the response', async () => {
    const items = [
      makeItem({ id: 'a', startAt: '2026-07-15T00:00:00.000Z' }),
      makeItem({ id: 'b', startAt: null }),
    ]
    listTemporalEventsForUserMock.mockResolvedValueOnce({ items, nextCursor: { startAt: 'x', id: 'a' } })

    const result = await loadUnifiedTimeline({
      userId: 'u1',
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      author: 'user',
    })

    expect(result.items).toEqual(items)
    expect(result).not.toHaveProperty('nextCursor')
    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        status: 'all',
        includeTasks: true,
        includeUndated: true,
        alwaysIncludeOpen: true,
        limit: MAX_LIST_LIMIT,
        from: '2026-07-14T00:00:00.000Z',
        to: '2026-07-20T23:59:59.999Z',
        author: 'user',
      }),
    )
    const call = listTemporalEventsForUserMock.mock.calls[0][0]
    expect(call.cursorStartAt).toBeUndefined()
    expect(call.cursorId).toBeUndefined()
  })

  it('always forces includeUndated true so undated todos survive date-range presets', async () => {
    await loadUnifiedTimeline({
      userId: 'u1',
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
    })

    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ includeUndated: true, alwaysIncludeOpen: true }),
    )
  })

  it('forces alwaysIncludeOpen so dated open tasks survive dial windows', async () => {
    await loadUnifiedTimeline({
      userId: 'u1',
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
    })

    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysIncludeOpen: true }),
    )
  })

  it('loads project catalog only for projectEntityIds present on items', async () => {
    const items = [
      makeItem({
        id: 't1',
        projectEntityId: 'proj-a',
        projectLabel: 'Alpha',
      }),
      makeItem({
        id: 't2',
        projectEntityId: 'proj-a',
        projectLabel: 'Alpha',
      }),
      makeItem({ id: 't3', projectEntityId: null }),
    ]
    const catalog: ProjectListItem[] = [
      {
        entityId: 'proj-a',
        label: 'Alpha',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 2,
        targetDate: '2026-08-01T00:00:00.000Z',
        tasks: [],
        milestones: [],
      },
    ]
    listTemporalEventsForUserMock.mockResolvedValueOnce({ items, nextCursor: null })
    listProjectsByEntityIdsMock.mockResolvedValueOnce(catalog)

    const result = await loadUnifiedTimeline({ userId: 'u1', from: null, to: null })

    expect(listProjectsByEntityIdsMock).toHaveBeenCalledWith('u1', ['proj-a'])
    expect(result.projects).toEqual(catalog)
  })

  it('omits projects that have no tasks in the loaded item set', async () => {
    listTemporalEventsForUserMock.mockResolvedValueOnce({
      items: [makeItem({ id: 'solo', projectEntityId: null })],
      nextCursor: null,
    })
    listProjectsByEntityIdsMock.mockResolvedValueOnce([])

    const result = await loadUnifiedTimeline({ userId: 'u1' })

    expect(listProjectsByEntityIdsMock).toHaveBeenCalledWith('u1', [])
    expect(result.projects).toEqual([])
  })

  it('passes from/to null for All time so list uses unbounded absolute mode', async () => {
    await loadUnifiedTimeline({
      userId: 'u1',
      from: null,
      to: null,
    })

    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: null,
        to: null,
        alwaysIncludeOpen: true,
        includeUndated: true,
      }),
    )
  })
})
