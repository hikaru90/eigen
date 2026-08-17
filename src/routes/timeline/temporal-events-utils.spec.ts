import { describe, expect, it, vi } from 'vitest'
import {
  agendaSectionForItem,
  buildMonthGrid,
  calendarDateKey,
  eventDateKeys,
  eventsOnDay,
  filterActiveItems,
  filterItemsByRange,
  filterItemsByStatus,
  filterDefaultVisibleTimelineItems,
  filterUnassignedOpenTimelineItems,
  filterOpenTimelineItemsForProject,
  filterSnoozedItems,
  filterItemsForTodayView,
  filterItemsForUpcomingView,
  filterTodayTodoOpenItems,
  filterOverdueItems,
  filterItemsByEngageFilters,
  filterProjectsByStatus,
  formatWhen,
  groupByAgendaSection,
  groupByKind,
  groupByMatrixQuadrant,
  groupByProject,
  groupByProjectEntityId,
  filterRangeScopedTodoItems,
  filterRangeScopedDoneItems,
  findTemporalListItemByRef,
  isTaskListItem,
  agentsAssignableToProject,
  projectHasAssignableAgent,
  localViewDayKey,
  overdueDebtMinutes,
  projectsLayoutOptions,
  selectFocusItems,
  splitTodayEngageSections,
  splitTodayFocusAndLater,
} from './temporal-events-utils'
import type { TemporalEventListItem } from '../api/temporal-events/+server'

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
  return {
    id: '1',
    itemType: 'event',
    kind: 'appointment',
    semanticSummary: 'Test',
    sourceTextSpan: null,
    timePrecision: 'day',
    timezone: 'UTC',
    isAllDay: true,
    confidence: 1,
    startAt: '2026-05-20T00:00:00.000Z',
    endAt: '2026-05-21T00:00:00.000Z',
    activePeriod: '',
    graphSyncStatus: 'synced',
    graphSyncError: null,
    thoughtId: 't1',
    thoughtText: 'thought',
    thoughtCategory: 'fact',
    thoughtStatus: 'open',
    lifecycleStatus: 'open',
    snoozedUntil: null,
    recurrenceRule: null,
    durationMinutes: null,
    energyLevel: null,
    priorityQuadrant: null,
    contextTags: [],
    focusRank: null,
    parentEventId: null,
    projectLabel: null,
    completedAt: null,
    lifecycleUpdatedAt: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('isTaskListItem', () => {
  it('recognizes task-only rows by itemType and id prefix', () => {
    expect(isTaskListItem(item({ id: 'task:abc', itemType: 'task' }))).toBe(true)
    expect(isTaskListItem(item({ id: 'open-loop:abc', itemType: 'open_loop' as 'task' }))).toBe(
      true,
    )
  })

  it('recognizes scheduled task thoughts rendered as temporal events', () => {
    expect(
      isTaskListItem(
        item({
          id: 'event-uuid',
          itemType: 'event',
          thoughtCategory: 'task',
          kind: 'deadline',
        }),
      ),
    ).toBe(true)
  })

  it('recognizes legacy open_loop memory type rows', () => {
    expect(
      isTaskListItem(
        item({
          id: 'event-uuid',
          itemType: 'event',
          thoughtCategory: 'fact',
          kind: 'reminder',
        }),
      ),
    ).toBe(true)
  })

  it('recognizes canonical task memory type rows', () => {
    expect(
      isTaskListItem(
        item({
          id: 'event-uuid',
          itemType: 'event',
          thoughtCategory: 'observation',
          kind: 'reminder',
        }),
      ),
    ).toBe(true)
  })

  it('does not treat non-task temporal events as tasks', () => {
    expect(
      isTaskListItem(
        item({
          id: 'event-uuid',
          itemType: 'event',
          thoughtCategory: 'fact',
          kind: 'appointment',
        }),
      ),
    ).toBe(false)
  })
})

describe('findTemporalListItemByRef', () => {
  it('finds rows by event id or task:thoughtId ref', () => {
    const rows = [
      item({ id: 'event-1', thoughtId: 'thought-1' }),
      item({ id: 'task:thought-2', itemType: 'task', thoughtId: 'thought-2' }),
    ]
    expect(findTemporalListItemByRef(rows, 'event-1')?.id).toBe('event-1')
    expect(findTemporalListItemByRef(rows, 'task:thought-1')?.id).toBe('event-1')
    expect(findTemporalListItemByRef(rows, 'task:thought-2')?.id).toBe('task:thought-2')
  })
})

describe('agentsAssignableToProject', () => {
  const agents = [
    { id: 'global', enabled: true },
    { id: 'bound', enabled: true },
    { id: 'other', enabled: true },
  ]

  it('includes global agents and project-bound agents only', () => {
    const bindings = {
      global: [],
      bound: [{ projectEntityId: 'proj-a' }],
      other: [{ projectEntityId: 'proj-b' }],
    }
    const assignable = agentsAssignableToProject(agents, bindings, 'proj-a').map((a) => a.id)
    expect(assignable).toEqual(['global', 'bound'])
    expect(projectHasAssignableAgent(agents, bindings, 'proj-a')).toBe(true)
    expect(projectHasAssignableAgent(agents, bindings, 'proj-z')).toBe(true)
  })
})

describe('filterItemsByStatus', () => {
  it('hides completed events when filter is open', () => {
    const items = [
      item({ id: 'a', lifecycleStatus: 'open' }),
      item({ id: 'b', lifecycleStatus: 'completed' }),
    ]
    expect(filterItemsByStatus(items, 'open').map((i) => i.id)).toEqual(['a'])
  })

  it('hides archived events when filter is open', () => {
    const items = [
      item({ id: 'a', lifecycleStatus: 'open' }),
      item({ id: 'b', lifecycleStatus: 'archived' }),
    ]
    expect(filterItemsByStatus(items, 'open').map((i) => i.id)).toEqual(['a'])
  })

  it('includes completed events when filter is all', () => {
    const items = [
      item({ id: 'a', thoughtStatus: 'open' }),
      item({ id: 'b', thoughtStatus: 'completed' }),
    ]
    expect(filterItemsByStatus(items, 'all')).toHaveLength(2)
  })

  it('hides open loops completed via thoughtStatus when filter is open', () => {
    const items = [
      item({ id: 'a', itemType: 'task', thoughtStatus: 'open', lifecycleStatus: 'open' }),
      item({
        id: 'b',
        itemType: 'task',
        thoughtStatus: 'completed',
        lifecycleStatus: 'open',
      }),
    ]
    expect(filterItemsByStatus(items, 'open').map((i) => i.id)).toEqual(['a'])
  })
})

describe('default-visible timeline items (hide completed by default)', () => {
  it('filterDefaultVisibleTimelineItems drops completed and archived', () => {
    const items = [
      item({ id: 'open', lifecycleStatus: 'open' }),
      item({ id: 'done', lifecycleStatus: 'completed' }),
      item({ id: 'archived', lifecycleStatus: 'archived' }),
    ]
    expect(filterDefaultVisibleTimelineItems(items).map((i) => i.id)).toEqual(['open'])
  })

  it('filterUnassignedOpenTimelineItems hides completed and assigned rows', () => {
    const items = [
      item({
        id: 'task:a',
        itemType: 'task',
        projectEntityId: null,
        lifecycleStatus: 'open',
        createdAt: '2026-05-19T00:00:00.000Z',
      }),
      item({
        id: 'task:b',
        itemType: 'task',
        projectEntityId: null,
        lifecycleStatus: 'completed',
        createdAt: '2026-05-20T00:00:00.000Z',
      }),
      item({
        id: 'task:c',
        itemType: 'task',
        projectEntityId: 'proj-1',
        lifecycleStatus: 'open',
        createdAt: '2026-05-21T00:00:00.000Z',
      }),
    ]
    expect(filterUnassignedOpenTimelineItems(items).map((i) => i.id)).toEqual(['task:a'])
  })

  it('filterOpenTimelineItemsForProject hides completed and can exclude next action', () => {
    const items = [
      item({
        id: 'task:next',
        itemType: 'task',
        thoughtId: 't-next',
        projectEntityId: 'proj-1',
        lifecycleStatus: 'open',
      }),
      item({
        id: 'task:other',
        itemType: 'task',
        thoughtId: 't-other',
        projectEntityId: 'proj-1',
        lifecycleStatus: 'open',
      }),
      item({
        id: 'task:done',
        itemType: 'task',
        thoughtId: 't-done',
        projectEntityId: 'proj-1',
        lifecycleStatus: 'completed',
      }),
      item({
        id: 'task:else',
        itemType: 'task',
        projectEntityId: 'proj-2',
        lifecycleStatus: 'open',
      }),
    ]
    expect(
      filterOpenTimelineItemsForProject(items, 'proj-1', {
        excludeItemId: 'task:next',
        excludeThoughtId: 't-next',
      }).map((i) => i.id),
    ).toEqual(['task:other'])
  })
})

describe('projects view default-visibility wiring', () => {
  it('ProjectsView uses shared open-only filters (not raw completed rows)', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'timeline-projects-view.svelte'),
      'utf-8',
    )
    expect(source).toContain('filterOpenTimelineItemsForProject')
    expect(source).toContain('projectCards')
    expect(source).toContain('data-testid="project-card"')
    expect(source).toContain('/memory/projects/')
    expect(source).not.toContain('filterRangeScopedTodoItems')
    expect(source).not.toContain("fetch('/api/timeline/projects")
    expect(source).not.toContain('TimelineProjectDetailDialog')
  })
})

function day(year: number, month: number, date: number): Date {
  return new Date(year, month - 1, date)
}

describe('calendarDateKey', () => {
  it('maps UTC midnight to the UTC calendar date', () => {
    expect(calendarDateKey('2026-05-20T00:00:00.000Z', 'UTC')).toBe('2026-05-20')
  })
})

describe('eventDateKeys', () => {
  it('uses half-open range for single UTC all-day day', () => {
    expect(eventDateKeys(item())).toEqual({
      startKey: '2026-05-20',
      endKey: '2026-05-21',
    })
  })
})

describe('eventsOnDay', () => {
  it('shows UTC all-day event on exactly one local grid day (May 20)', () => {
    const ev = item()
    const hits = [18, 19, 20, 21, 22].map((d) => ({
      day: d,
      count: eventsOnDay([ev], day(2026, 5, d)).length,
    }))
    expect(hits.find((h) => h.day === 20)?.count).toBe(1)
    expect(hits.filter((h) => h.count > 0)).toHaveLength(1)
    expect(hits.find((h) => h.day === 20)?.count).toBe(1)
  })

  it('does not duplicate across adjacent local days regardless of host TZ', () => {
    const ev = item()
    let hitDays = 0
    for (let d = 1; d <= 31; d++) {
      if (eventsOnDay([ev], day(2026, 5, d)).length > 0) hitDays++
    }
    expect(hitDays).toBe(1)
  })

  it('matches event timezone calendar dates to local view keys', () => {
    const ev = item({
      timezone: 'UTC',
      startAt: '2026-05-20T00:00:00.000Z',
      endAt: '2026-05-21T00:00:00.000Z',
    })
    const keys = eventDateKeys(ev)!
    const viewMay20 = localViewDayKey(day(2026, 5, 20))
    expect(viewMay20 >= keys.startKey && viewMay20 < keys.endKey).toBe(true)
  })

  it('places timed appointment on a single local day', () => {
    const ev = item({
      isAllDay: false,
      timePrecision: 'exact',
      timezone: 'UTC',
      startAt: '2026-05-20T15:00:00.000Z',
      endAt: '2026-05-20T16:00:00.000Z',
    })
    expect(eventsOnDay([ev], day(2026, 5, 20))).toHaveLength(1)
    expect(eventsOnDay([ev], day(2026, 5, 19))).toHaveLength(0)
    expect(eventsOnDay([ev], day(2026, 5, 21))).toHaveLength(0)
  })

  it('ignores items with null startAt', () => {
    const ev = item({ startAt: null })
    expect(eventsOnDay([ev], day(2026, 5, 20))).toHaveLength(0)
  })
})

describe('formatWhen', () => {
  it('formats all-day dates in event timezone', () => {
    const label = formatWhen(item())
    expect(label).toMatch(/May/)
    expect(label).toMatch(/20/)
  })

  it('formats timed events in viewer timezone', () => {
    const ev = item({
      timePrecision: 'exact',
      isAllDay: false,
      timezone: 'UTC',
      startAt: '2026-06-16T16:01:00.000Z',
    })
    const berlin = formatWhen(ev, 'Europe/Berlin')
    expect(berlin).toMatch(/18:01|6:01/)
  })
})

describe('filterTodayTodoOpenItems', () => {
  it('includes prior-day overdue items alongside today open items', () => {
    const now = new Date('2026-06-16T17:00:00.000Z')
    const overdueYesterday = item({
      id: 'yesterday',
      startAt: '2026-06-15T08:00:00.000Z',
      endAt: '2026-06-15T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const upcoming = item({
      id: 'soon',
      startAt: '2026-06-16T20:00:00.000Z',
      endAt: '2026-06-16T21:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const todos = filterTodayTodoOpenItems([overdueYesterday, upcoming], 'Europe/Berlin', now)
    expect(todos.map((i) => i.id)).toEqual(['soon', 'yesterday'])
  })

  it('includes overdue items still scheduled for today', () => {
    const now = new Date('2026-06-16T17:00:00.000Z')
    const overdueToday = item({
      id: 'late',
      startAt: '2026-06-16T08:00:00.000Z',
      endAt: '2026-06-16T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const upcoming = item({
      id: 'soon',
      startAt: '2026-06-16T20:00:00.000Z',
      endAt: '2026-06-16T21:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const todos = filterTodayTodoOpenItems([overdueToday, upcoming], 'Europe/Berlin', now)
    expect(todos.map((i) => i.id)).toEqual(['late', 'soon'])
  })

  it('matches splitTodayFocusAndLater open item count', () => {
    const now = new Date('2026-06-16T17:00:00.000Z')
    const overdue = item({
      id: 'late',
      startAt: '2026-06-16T08:00:00.000Z',
      endAt: '2026-06-16T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const upcoming = item({
      id: 'soon',
      startAt: '2026-06-16T20:00:00.000Z',
      endAt: '2026-06-16T21:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const todos = filterTodayTodoOpenItems([overdue, upcoming], 'Europe/Berlin', now)
    const { focus, later } = splitTodayFocusAndLater([overdue, upcoming], 'Europe/Berlin', now)
    expect(focus.length + later.length).toBe(todos.length)
  })

  it('excludes completed rows that remain in an overdue merge (timeline todo prop contract)', () => {
    const now = new Date('2026-06-16T17:00:00.000Z')
    const completedOverdue = item({
      id: 'done-overdue',
      startAt: '2026-06-15T08:00:00.000Z',
      endAt: '2026-06-15T09:00:00.000Z',
      timezone: 'Europe/Berlin',
      lifecycleStatus: 'completed',
      thoughtStatus: 'completed',
    })
    const openSoon = item({
      id: 'soon',
      startAt: '2026-06-16T20:00:00.000Z',
      endAt: '2026-06-16T21:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const todos = filterTodayTodoOpenItems([completedOverdue, openSoon], 'Europe/Berlin', now)
    expect(todos.map((i) => i.id)).toEqual(['soon'])
  })
})

describe('splitTodayFocusAndLater', () => {
  it('keeps overdue-today items in today todo lists', () => {
    const now = new Date('2026-06-16T17:00:00.000Z')
    const overdue = item({
      id: 'late',
      startAt: '2026-06-16T08:00:00.000Z',
      endAt: '2026-06-16T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const upcoming = item({
      id: 'soon',
      startAt: '2026-06-16T20:00:00.000Z',
      endAt: '2026-06-16T21:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const { focus, later } = splitTodayFocusAndLater([overdue, upcoming], 'Europe/Berlin', now)
    expect(focus.map((i) => i.id).concat(later.map((i) => i.id))).toEqual(['late', 'soon'])
  })
})

describe('agendaSectionForItem', () => {
  it('keeps today calendar items in today even after end time passes', () => {
    const now = new Date('2026-06-16T17:00:00.000Z')
    const overdueToday = item({
      startAt: '2026-06-16T08:00:00.000Z',
      endAt: '2026-06-16T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    expect(agendaSectionForItem(overdueToday, now, 'Europe/Berlin')).toBe('today')
  })
})

describe('groupByKind', () => {
  it('groups items into kind columns', () => {
    const map = groupByKind([
      item({ id: 'a', kind: 'deadline' }),
      item({ id: 'b', kind: 'appointment' }),
    ])
    expect(map.get('deadline')).toHaveLength(1)
    expect(map.get('appointment')).toHaveLength(1)
  })
})

describe('buildMonthGrid', () => {
  it('returns 42 cells for a month grid', () => {
    expect(buildMonthGrid(new Date(2026, 4, 1))).toHaveLength(42)
  })
})

describe('filterItemsByRange', () => {
  it('relevant includes upcoming and near-future items', () => {
    const now = new Date('2026-05-20T12:00:00.000Z')
    const items = [
      item({ id: 'past', startAt: '2026-05-01T00:00:00.000Z', endAt: '2026-05-02T00:00:00.000Z' }),
      item({ id: 'soon', startAt: '2026-05-25T00:00:00.000Z', endAt: '2026-05-26T00:00:00.000Z' }),
    ]
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(filterItemsByRange(items, 'relevant').map((i) => i.id)).toEqual(['soon'])
    vi.useRealTimers()
  })

  it('keeps unscheduled open loops in relevant and upcoming ranges', () => {
    const unscheduled = item({ id: 'loop', startAt: null, endAt: null, itemType: 'task' })
    expect(filterItemsByRange([unscheduled], 'relevant').map((i) => i.id)).toEqual(['loop'])
    expect(filterItemsByRange([unscheduled], 'upcoming').map((i) => i.id)).toEqual(['loop'])
    expect(filterItemsByRange([unscheduled], 'past').map((i) => i.id)).toEqual([])
  })
})

describe('groupByAgendaSection', () => {
  it('places same-day events in today section', () => {
    const now = new Date('2026-05-20T12:00:00.000Z')
    const todayItem = item({
      id: 'today',
      startAt: '2026-05-20T14:00:00.000Z',
      endAt: '2026-05-20T15:00:00.000Z',
      timePrecision: 'exact',
      isAllDay: false,
    })
    const map = groupByAgendaSection([todayItem], 'UTC', now)
    expect(map.get('today')).toHaveLength(1)
    expect(agendaSectionForItem(todayItem, now, 'UTC')).toBe('today')
  })
})

describe('selectFocusItems', () => {
  it('prefers deadlines today over later items', () => {
    const now = new Date('2026-05-20T12:00:00.000Z')
    const deadlineToday = item({
      id: 'd1',
      kind: 'deadline',
      startAt: '2026-05-20T18:00:00.000Z',
      endAt: '2026-05-20T19:00:00.000Z',
      timePrecision: 'exact',
      isAllDay: false,
    })
    const later = item({
      id: 'l1',
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-06-02T00:00:00.000Z',
    })
    const focus = selectFocusItems([later, deadlineToday], 'UTC', 3, now)
    expect(focus[0]?.id).toBe('d1')
  })
})

describe('splitTodayFocusAndLater', () => {
  it('keeps top three open items in focus and the rest in later', () => {
    const now = new Date('2026-06-08T08:00:00.000Z')
    const items = [
      item({ id: 'a', startAt: '2026-06-08T09:00:00.000Z', endAt: '2026-06-08T10:00:00.000Z' }),
      item({ id: 'b', startAt: '2026-06-08T11:00:00.000Z', endAt: '2026-06-08T12:00:00.000Z' }),
      item({ id: 'c', startAt: '2026-06-08T13:00:00.000Z', endAt: '2026-06-08T14:00:00.000Z' }),
      item({ id: 'd', startAt: '2026-06-08T15:00:00.000Z', endAt: '2026-06-08T16:00:00.000Z' }),
      item({ id: 'e', startAt: '2026-06-08T17:00:00.000Z', endAt: '2026-06-08T18:00:00.000Z' }),
    ]
    const { focus, later } = splitTodayFocusAndLater(items, 'UTC', now)
    expect(focus.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(later.map((i) => i.id)).toEqual(['d', 'e'])
  })
})

describe('snooze filters', () => {
  it('filterSnoozedItems returns only snoozed rows', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const items = [item({ id: 'a' }), item({ id: 'b', snoozedUntil: future })]
    expect(filterSnoozedItems(items).map((i) => i.id)).toEqual(['b'])
    expect(filterActiveItems(items).map((i) => i.id)).toEqual(['a'])
  })
})

describe('groupByMatrixQuadrant', () => {
  it('buckets by priorityQuadrant', () => {
    const items = [
      item({ id: '1', priorityQuadrant: 'urgent_important' }),
      item({ id: '2', priorityQuadrant: null }),
    ]
    const map = groupByMatrixQuadrant(items)
    expect(map.get('urgent_important')).toHaveLength(1)
    expect(map.get('unclassified')).toHaveLength(1)
  })
})

describe('groupByProject', () => {
  it('groups items by project label with fallback last', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({ id: 'a', projectLabel: 'Eigen Mesh', startAt: null }),
      item({ id: 'b', projectLabel: 'LoRaWAN', startAt: null }),
      item({ id: 'c', projectLabel: null, startAt: null }),
    ]
    const groups = groupByProject(items, 'General', 'UTC', now)
    expect(groups).toHaveLength(3)
    expect(groups[0]?.projectLabel).toBe('Eigen Mesh')
    expect(groups[1]?.projectLabel).toBe('LoRaWAN')
    expect(groups[2]?.projectLabel).toBe('General')
  })
})

describe('groupByProjectEntityId', () => {
  it('groups by projectEntityId and omits empty hubs', () => {
    const items = [
      item({
        id: 'a',
        projectEntityId: 'ent-1',
        projectLabel: 'Alpha',
        lifecycleStatus: 'open',
        startAt: null,
      }),
      item({
        id: 'b',
        projectEntityId: 'ent-1',
        projectLabel: 'Alpha',
        lifecycleStatus: 'open',
        startAt: null,
      }),
      item({
        id: 'c',
        projectEntityId: 'ent-2',
        projectLabel: 'Beta',
        lifecycleStatus: 'open',
        startAt: null,
      }),
      item({
        id: 'd',
        projectEntityId: null,
        projectLabel: null,
        lifecycleStatus: 'open',
        startAt: null,
      }),
    ]
    const { groups, unassigned } = groupByProjectEntityId(items)
    expect(groups.map((g) => g.projectEntityId)).toEqual(['ent-1', 'ent-2'])
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(groups[0]?.projectLabel).toBe('Alpha')
    expect(unassigned.map((i) => i.id)).toEqual(['d'])
  })

  it('does not invent groups for entity ids absent from the filtered set', () => {
    const { groups } = groupByProjectEntityId([
      item({ id: 'only', projectEntityId: 'ent-x', projectLabel: 'X', startAt: null }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.projectEntityId).toBe('ent-x')
  })
})

describe('filterRangeScopedTodoItems', () => {
  it('returns open non-snoozed items from the shared set (no calendar-today gate)', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const items = [
      item({
        id: 'in-range-open',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        startAt: '2026-07-18T10:00:00.000Z',
        endAt: '2026-07-18T11:00:00.000Z',
        isAllDay: false,
        timePrecision: 'minute',
      }),
      item({
        id: 'done',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        startAt: '2026-07-18T10:00:00.000Z',
        endAt: '2026-07-18T11:00:00.000Z',
      }),
      item({
        id: 'snoozed',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        snoozedUntil: '2026-07-22T12:00:00.000Z',
        startAt: null,
      }),
    ]
    expect(filterRangeScopedTodoItems(items, now).map((i) => i.id)).toEqual(['in-range-open'])
  })

  it('includes completed when statusFilter is all (show completed)', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const items = [
      item({
        id: 'open',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        startAt: null,
      }),
      item({
        id: 'done',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        startAt: null,
      }),
    ]
    expect(filterRangeScopedTodoItems(items, now, 'all').map((i) => i.id)).toEqual(['open', 'done'])
    expect(filterRangeScopedTodoItems(items, now, 'open').map((i) => i.id)).toEqual(['open'])
  })
})

describe('filterRangeScopedDoneItems', () => {
  it('returns completed non-snoozed items from the shared set (no calendar-today gate)', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const items = [
      item({
        id: 'open',
        lifecycleStatus: 'open',
        thoughtStatus: 'open',
        startAt: null,
      }),
      item({
        id: 'done',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        startAt: null,
        completedAt: '2026-07-10T12:00:00.000Z',
      }),
      item({
        id: 'done-snoozed',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        snoozedUntil: '2026-07-22T12:00:00.000Z',
        startAt: null,
        completedAt: '2026-07-10T12:00:00.000Z',
      }),
    ]
    expect(filterRangeScopedDoneItems(items, now).map((i) => i.id)).toEqual(['done'])
  })
})

describe('range-scoped list wiring', () => {
  it('shell derives open/done/overdue from one source without merging overdue into todo', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'timeline-shell.svelte'),
      'utf-8',
    )
    expect(source).toContain('data.openItems')
    expect(source).toContain('data.doneItems')
    expect(source).toContain('data.overdueItems')
    expect(source).not.toContain('mergePriorDayOverdueIntoItems')
    expect(source).toContain('data.todoItems.length === 0')
  })
})

describe('projects view shared-data wiring', () => {
  it('ProjectsView receives projectCards and does not fetch timeline/projects catalog', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'timeline-projects-view.svelte'),
      'utf-8',
    )
    expect(source).toContain('projectCards: TimelineProjectCard[]')
    expect(source).not.toMatch(/fetch\(`?['"]\/api\/temporal-events/)
    expect(source).not.toContain("fetch('/api/timeline/projects")
  })

  it('shell does not send kinds query params', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const shell = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'timeline-shell.svelte'),
      'utf-8',
    )
    const derive = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'timeline-data-derive.ts'),
      'utf-8',
    )
    expect(shell).toContain('TimelineDateRangeDial')
    expect(shell).not.toContain("params.set('kinds'")
    expect(derive).not.toContain('kinds=')
  })

  it('options popover has no kinds checkboxes', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const path = await import('node:path')
    const source = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'temporal-timeline-options-popover.svelte',
      ),
      'utf-8',
    )
    expect(source).not.toContain('KANBAN_KIND_ORDER')
    expect(source).not.toContain('onToggleKind')
    expect(source).not.toContain('graph_timeline_filters_kinds')
  })
})

describe('filterItemsForTodayView', () => {
  it('includes today and unscheduled items', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({
        id: 'today',
        startAt: '2026-06-08T10:00:00.000Z',
        endAt: '2026-06-08T14:00:00.000Z',
        isAllDay: false,
        timePrecision: 'minute',
      }),
      item({
        id: 'later',
        startAt: '2026-06-10T10:00:00.000Z',
        endAt: '2026-06-10T11:00:00.000Z',
        isAllDay: false,
        timePrecision: 'minute',
      }),
      item({ id: 'open', startAt: null, endAt: null }),
    ]
    const filtered = filterItemsForTodayView(items, 'UTC', now)
    expect(filtered.map((i) => i.id).sort()).toEqual(['open', 'today'])
  })
})

describe('filterItemsForUpcomingView', () => {
  it('includes future scheduled open items', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({
        id: 'today',
        startAt: '2026-06-08T10:00:00.000Z',
        endAt: '2026-06-08T11:00:00.000Z',
        isAllDay: false,
        timePrecision: 'minute',
      }),
      item({
        id: 'later',
        startAt: '2026-06-10T10:00:00.000Z',
        endAt: '2026-06-10T11:00:00.000Z',
        isAllDay: false,
        timePrecision: 'minute',
      }),
      item({
        id: 'done',
        startAt: '2026-06-10T10:00:00.000Z',
        endAt: '2026-06-10T11:00:00.000Z',
        isAllDay: false,
        timePrecision: 'minute',
        lifecycleStatus: 'completed',
      }),
    ]
    const filtered = filterItemsForUpcomingView(items, 'UTC', now)
    expect(filtered.map((i) => i.id)).toEqual(['later'])
  })
})

describe('overdueDebtMinutes', () => {
  it('sums duration for overdue open events', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const items = [
      item({
        id: 'o1',
        endAt: '2026-05-20T00:00:00.000Z',
        durationMinutes: 90,
        lifecycleStatus: 'open',
      }),
    ]
    expect(overdueDebtMinutes(items, now)).toBe(90)
  })
})

describe('filterOverdueItems', () => {
  it('returns open items with past end or start times', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({
        id: 'overdue',
        endAt: '2026-06-07T12:00:00.000Z',
        lifecycleStatus: 'open',
      }),
      item({
        id: 'future',
        startAt: '2026-06-09T10:00:00.000Z',
        endAt: '2026-06-09T12:00:00.000Z',
        lifecycleStatus: 'open',
      }),
    ]
    expect(filterOverdueItems(items, now).map((i) => i.id)).toEqual(['overdue'])
  })
})

describe('timeline navigation helpers', () => {
  it('TimelineShellView values are tasks and projects only', () => {
    const shells = ['tasks', 'projects'] as const
    expect(shells).toHaveLength(2)
  })

  it('projectsLayoutOptions returns list, agenda, matrix', () => {
    expect(projectsLayoutOptions()).toEqual(['list', 'agenda', 'matrix'])
  })
})

describe('filterItemsByEngageFilters', () => {
  it('filters by context tag, energy, and max minutes', () => {
    const items = [
      item({
        id: 'a',
        contextTags: ['computer'],
        energyLevel: 'deep',
        durationMinutes: 45,
      }),
      item({
        id: 'b',
        contextTags: ['errands'],
        energyLevel: 'light',
        durationMinutes: 10,
      }),
    ]
    expect(
      filterItemsByEngageFilters(items, {
        contextTags: ['computer'],
        energyLevels: [],
        maxMinutes: null,
      }).map((i) => i.id),
    ).toEqual(['a'])
    expect(
      filterItemsByEngageFilters(items, {
        contextTags: [],
        energyLevels: ['light'],
        maxMinutes: null,
      }).map((i) => i.id),
    ).toEqual(['b'])
    expect(
      filterItemsByEngageFilters(items, {
        contextTags: [],
        energyLevels: [],
        maxMinutes: 15,
      }).map((i) => i.id),
    ).toEqual(['b'])
  })
})

describe('filterProjectsByStatus', () => {
  it('filters active and someday projects', () => {
    const projects = [
      { entityId: '1', status: 'active' as const },
      { entityId: '2', status: 'someday' as const },
    ]
    expect(filterProjectsByStatus(projects, 'all')).toHaveLength(2)
    expect(filterProjectsByStatus(projects, 'active')).toHaveLength(1)
    expect(filterProjectsByStatus(projects, 'someday')[0].entityId).toBe('2')
  })
})

describe('splitTodayEngageSections', () => {
  it('puts light energy items in lowEnergy section', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({
        id: 'deep',
        startAt: '2026-06-08T14:00:00.000Z',
        energyLevel: 'deep',
        lifecycleStatus: 'open',
      }),
      item({
        id: 'light',
        startAt: '2026-06-08T15:00:00.000Z',
        energyLevel: 'light',
        lifecycleStatus: 'open',
      }),
    ]
    const { focus, later, lowEnergy } = splitTodayEngageSections(items, 'UTC', undefined, now)
    expect(lowEnergy.map((i) => i.id)).toEqual(['light'])
    expect([...focus, ...later].map((i) => i.id)).not.toContain('light')
  })
})

describe('project grouping in today view', () => {
  it('separates items with project labels from those without', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({ id: 'p1', projectLabel: 'Eigen Mesh', startAt: '2026-06-08T14:00:00.000Z' }),
      item({ id: 'p2', projectLabel: 'Eigen Mesh', startAt: '2026-06-08T15:00:00.000Z' }),
      item({ id: 'p3', projectLabel: 'LoRaWAN', startAt: '2026-06-08T16:00:00.000Z' }),
      item({ id: 'u1', projectLabel: null, startAt: '2026-06-08T17:00:00.000Z' }),
      item({ id: 'u2', projectLabel: null, startAt: '2026-06-08T18:00:00.000Z' }),
    ]

    const withProject = items.filter((i) => i.projectLabel && i.projectLabel.trim())
    const withoutProject = items.filter((i) => !i.projectLabel || !i.projectLabel.trim())

    const groups = groupByProject(withProject, 'General', 'UTC', now)
    const { focus, later } = splitTodayEngageSections(withoutProject, 'UTC', undefined, now)

    // Project groups: Eigen Mesh (2 items), LoRaWAN (1 item)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.projectLabel).toBe('Eigen Mesh')
    expect(groups[0]?.items).toHaveLength(2)
    expect(groups[1]?.projectLabel).toBe('LoRaWAN')
    expect(groups[1]?.items).toHaveLength(1)

    // Ungrouped items go to engage sections
    const ungroupedCount = focus.length + later.length
    expect(ungroupedCount).toBe(2)
  })

  it('puts all items in engage sections when none have project labels', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({ id: 'a', projectLabel: null, startAt: '2026-06-08T14:00:00.000Z' }),
      item({ id: 'b', projectLabel: null, startAt: '2026-06-08T15:00:00.000Z' }),
    ]

    const withProject = items.filter((i) => i.projectLabel && i.projectLabel.trim())
    const withoutProject = items.filter((i) => !i.projectLabel || !i.projectLabel.trim())

    const groups = groupByProject(withProject, 'General', 'UTC', now)
    const { focus, later } = splitTodayEngageSections(withoutProject, 'UTC', undefined, now)

    expect(groups).toHaveLength(0)
    expect(focus.length + later.length).toBe(2)
  })

  it('puts all items in project groups when all have project labels', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    const items = [
      item({ id: 'p1', projectLabel: 'Project A', startAt: '2026-06-08T14:00:00.000Z' }),
      item({ id: 'p2', projectLabel: 'Project B', startAt: '2026-06-08T15:00:00.000Z' }),
    ]

    const withProject = items.filter((i) => i.projectLabel && i.projectLabel.trim())
    const withoutProject = items.filter((i) => !i.projectLabel || !i.projectLabel.trim())

    const groups = groupByProject(withProject, 'General', 'UTC', now)
    const { focus, later } = splitTodayEngageSections(withoutProject, 'UTC', undefined, now)

    expect(groups).toHaveLength(2)
    expect(focus.length + later.length).toBe(0)
  })
})
