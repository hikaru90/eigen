import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectListItem } from '$lib/server/memory/project-list'
import { MAX_LIST_LIMIT } from '$lib/server/memory/temporal-event-list'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'

const { listTemporalEventsForUserMock, listProjectsMock } = vi.hoisted(() => ({
  listTemporalEventsForUserMock: vi.fn(),
  listProjectsMock: vi.fn(),
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
    listProjects: listProjectsMock,
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
    listProjectsMock.mockResolvedValue([])
  })

  it('returns the full item set with no nextCursor in the response', async () => {
    const items = [
      makeItem({ id: 'a', startAt: '2026-07-15T00:00:00.000Z' }),
      makeItem({ id: 'b', startAt: null }),
    ]
    listTemporalEventsForUserMock.mockResolvedValueOnce({
      items,
      nextCursor: { startAt: 'x', id: 'a' },
    })

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

  it('returns the scoped catalog, not just projects present on items', async () => {
    const items = [
      makeItem({
        id: 't1',
        projectEntityId: 'proj-a',
        projectLabel: 'Alpha',
      }),
      makeItem({ id: 't2', projectEntityId: null }),
    ]
    const catalog: ProjectListItem[] = [
      {
        entityId: 'proj-a',
        label: 'Alpha',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 1,
        targetDate: '2026-08-01T00:00:00.000Z',
        tasks: [],
        milestones: [],
      },
      {
        entityId: 'proj-empty',
        label: 'Empty project',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 0,
        targetDate: null,
        tasks: [],
        milestones: [],
      },
    ]
    listTemporalEventsForUserMock.mockResolvedValueOnce({ items, nextCursor: null })
    listProjectsMock.mockResolvedValueOnce(catalog)

    const result = await loadUnifiedTimeline({ userId: 'u1', from: null, to: null, author: 'user' })

    expect(result.projects).toEqual(catalog)
    expect(result.projects.map((p) => p.entityId)).toContain('proj-empty')
  })

  it('omits item join entirely — projects come from the scoped catalog loader', async () => {
    listTemporalEventsForUserMock.mockResolvedValueOnce({
      items: [makeItem({ id: 'solo', projectEntityId: null })],
      nextCursor: null,
    })

    const result = await loadUnifiedTimeline({ userId: 'u1' })

    expect(listProjectsMock).toHaveBeenCalledWith('u1', { kind: 'user' })
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

  it('defaults the catalog scope to user view', async () => {
    await loadUnifiedTimeline({ userId: 'u1' })

    expect(listProjectsMock).toHaveBeenCalledWith('u1', { kind: 'user' })
  })

  it('maps author=all to the all catalog scope', async () => {
    await loadUnifiedTimeline({ userId: 'u1', author: 'all' })

    expect(listProjectsMock).toHaveBeenCalledWith('u1', { kind: 'all' })
  })

  it('maps authorLayerKey to the agent authorLayer scope', async () => {
    await loadUnifiedTimeline({ userId: 'u1', authorLayerKey: 'apikey:abc-123' })

    expect(listProjectsMock).toHaveBeenCalledWith('u1', {
      kind: 'authorLayer',
      author: 'agent',
      authorLayerKey: 'apikey:abc-123',
    })
  })

  it('maps coarse author=agent to the agent authorLayer scope', async () => {
    await loadUnifiedTimeline({ userId: 'u1', author: 'agent' })

    expect(listProjectsMock).toHaveBeenCalledWith('u1', {
      kind: 'authorLayer',
      author: 'agent',
      authorLayerKey: null,
    })
  })
})
