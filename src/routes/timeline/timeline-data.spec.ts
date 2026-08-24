import { describe, expect, it } from 'vitest'
import type { ProjectListItem } from '$lib/server/memory/project-list'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import {
  buildTimelineApiUrl,
  deriveDoneItems,
  deriveOpenItems,
  deriveOverdueItems,
  deriveTodoItems,
  deriveProjectCards,
  deriveTabCounts,
  filterTimelineItemsBySearch,
  type TimelineDateRangeFilter,
} from './timeline-data-derive'

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

describe('timeline-data-derive', () => {
  const now = new Date('2026-07-23T12:00:00.000Z')
  const timeZone = 'UTC'

  it('derives open, done, overdue, and todo (non-overdue) so counts always match list lengths', () => {
    const items = [
      makeItem({
        id: 'open-1',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        startAt: '2026-07-24T00:00:00.000Z',
      }),
      makeItem({
        id: 'open-2',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        startAt: null,
      }),
      makeItem({
        id: 'done-1',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        completedAt: '2026-07-22T00:00:00.000Z',
        startAt: '2026-07-21T00:00:00.000Z',
      }),
      makeItem({
        id: 'overdue-1',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        startAt: '2026-07-20T00:00:00.000Z',
        endAt: '2026-07-21T00:00:00.000Z',
      }),
    ]

    const openItems = deriveOpenItems(items, now)
    const doneItems = deriveDoneItems(items, now)
    const overdueItems = deriveOverdueItems(openItems, timeZone, now)
    const todoItems = deriveTodoItems(openItems, overdueItems)
    const counts = deriveTabCounts({ todoItems, doneItems, overdueItems })

    expect(counts.todo).toBe(todoItems.length)
    expect(counts.done).toBe(doneItems.length)
    expect(counts.overdue).toBe(overdueItems.length)
    expect(counts.todo).toBe(2)
    expect(counts.done).toBe(1)
    expect(counts.overdue).toBe(1)
    expect(todoItems.map((i) => i.id).sort()).toEqual(['open-1', 'open-2'])
    expect(overdueItems.map((i) => i.id)).toEqual(['overdue-1'])
  })

  it('To Do list excludes prior-day overdue so badge 2 with 6 overdue never lists 8 rows', () => {
    const items = [
      makeItem({ id: 'due-a', startAt: '2026-05-27T00:00:00.000Z' }),
      makeItem({ id: 'due-b', startAt: '2026-06-05T00:00:00.000Z' }),
      makeItem({ id: 'due-c', startAt: '2026-06-19T00:00:00.000Z' }),
      makeItem({ id: 'due-d', startAt: '2026-06-27T00:00:00.000Z' }),
      makeItem({ id: 'due-e', startAt: '2026-06-27T21:50:00.000Z' }),
      makeItem({ id: 'due-f', startAt: '2026-05-27T15:37:00.000Z' }),
      makeItem({ id: 'undated-1', startAt: null }),
      makeItem({ id: 'undated-2', startAt: null }),
    ]
    const openItems = deriveOpenItems(items, now)
    const overdueItems = deriveOverdueItems(openItems, timeZone, now)
    const todoItems = deriveTodoItems(openItems, overdueItems)
    const counts = deriveTabCounts({
      todoItems,
      doneItems: [],
      overdueItems,
    })

    expect(openItems).toHaveLength(8)
    expect(overdueItems).toHaveLength(6)
    expect(todoItems).toHaveLength(2)
    expect(counts.todo).toBe(2)
    expect(counts.overdue).toBe(6)
    expect(todoItems.map((i) => i.id).sort()).toEqual(['undated-1', 'undated-2'])
  })

  it('builds project cards only for projects present on open items, joined with catalog', () => {
    const items = [
      makeItem({
        id: 't1',
        projectEntityId: 'proj-a',
        projectLabel: 'Alpha',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
      }),
      makeItem({
        id: 't2',
        projectEntityId: null,
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
      }),
    ]
    const catalog: ProjectListItem[] = [
      {
        entityId: 'proj-a',
        label: 'Alpha Catalog',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 1,
        targetDate: null,
        tasks: [],
        milestones: [],
      },
      {
        entityId: 'proj-orphan',
        label: 'Never shown',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 0,
        targetDate: null,
        tasks: [],
        milestones: [],
      },
    ]

    const openItems = deriveOpenItems(items, now)
    const cards = deriveProjectCards(openItems, catalog)

    expect(cards.map((c) => c.entityId)).toEqual(['proj-a'])
    expect(cards[0]?.label).toBe('Alpha Catalog')
    expect(cards[0]?.group.items.map((i) => i.id)).toEqual(['t1'])
  })

  describe('filterTimelineItemsBySearch', () => {
    const items = [
      makeItem({
        id: 'buy-milk',
        thoughtText: 'Buy milk tomorrow',
        semanticSummary: 'Grocery errand',
      }),
      makeItem({
        id: 'call-sam',
        thoughtText: 'Call Sam',
        semanticSummary: 'Phone reminder',
      }),
      makeItem({
        id: 'summary-only',
        thoughtText: 'misc note',
        semanticSummary: 'Schedule dentist appointment',
      }),
    ]

    it('returns all items when query is empty or whitespace', () => {
      expect(filterTimelineItemsBySearch(items, '')).toEqual(items)
      expect(filterTimelineItemsBySearch(items, '   ')).toEqual(items)
    })

    it('matches thoughtText case-insensitively', () => {
      const hit = filterTimelineItemsBySearch(items, 'BUY MILK')
      expect(hit.map((i) => i.id)).toEqual(['buy-milk'])
    })

    it('matches semanticSummary when thoughtText does not', () => {
      const hit = filterTimelineItemsBySearch(items, 'dentist')
      expect(hit.map((i) => i.id)).toEqual(['summary-only'])
    })

    it('returns empty when nothing matches', () => {
      expect(filterTimelineItemsBySearch(items, 'zeppelin')).toEqual([])
    })

    it('tab counts use filtered list lengths', () => {
      const filtered = filterTimelineItemsBySearch(items, 'call')
      const counts = deriveTabCounts({
        todoItems: filtered,
        doneItems: [],
        overdueItems: [],
      })
      expect(counts.todo).toBe(1)
      expect(counts.done).toBe(0)
      expect(counts.overdue).toBe(0)
    })
  })

  it('builds one /api/timeline URL from filters (single fetch target)', () => {
    const range: TimelineDateRangeFilter = {
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
      label: 'Last week',
    }
    const url = buildTimelineApiUrl({
      dateRange: range,
      dataView: 'user',
      orderBy: 'ingest',
      sortDirection: 'desc',
    })
    expect(url).toMatch(/^\/api\/timeline\?/)
    const parsed = new URL(url, 'http://local.test')
    expect(parsed.pathname).toBe('/api/timeline')
    expect(parsed.searchParams.get('from')).toBe(range.from)
    expect(parsed.searchParams.get('to')).toBe(range.to)
    expect(parsed.searchParams.get('author')).toBe('user')
    expect(parsed.searchParams.get('orderBy')).toBe('ingest')
    expect(parsed.searchParams.get('sortDirection')).toBe('desc')
    // Client may send dial includeUndated; server always forces undated open tasks in.
    expect(parsed.searchParams.has('includeUndated')).toBe(true)
  })
})
