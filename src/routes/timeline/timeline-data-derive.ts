import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import type { ProjectListItem } from '$lib/server/memory/project-list'
import type { CurrentUserView } from '$lib/memory/current-user-view'
import { filterPriorDayOverdueItems } from '$lib/graph/timeline-overdue'
import {
  filterActiveItems,
  filterDefaultVisibleTimelineItems,
  filterRangeScopedDoneItems,
  groupByProjectEntityId,
  type ProjectEntityGroup,
} from './temporal-events-utils'

export type TimelineDateRangeFilter = {
  from: string | null
  to: string | null
  includeUndated: boolean
  label: string
}

export type TimelineTabCounts = {
  todo: number
  done: number
  overdue: number
}

export type TimelineProjectCard = {
  entityId: string
  label: string
  status: ProjectListItem['status']
  catalog: ProjectListItem | null
  group: ProjectEntityGroup
}

export type TimelineFetchFilters = {
  dateRange: TimelineDateRangeFilter
  dataView: CurrentUserView
  orderBy: 'ingest' | 'todo'
  sortDirection: 'asc' | 'desc'
}

/** Open, non-snoozed items from the loaded set. */
export function deriveOpenItems(
  items: readonly TemporalEventListItem[],
  now = new Date(),
): TemporalEventListItem[] {
  return filterActiveItems(filterDefaultVisibleTimelineItems(items), now)
}

/** Completed, non-snoozed items from the loaded set (range already applied server-side). */
export function deriveDoneItems(
  items: readonly TemporalEventListItem[],
  now = new Date(),
): TemporalEventListItem[] {
  return filterRangeScopedDoneItems(items, now)
}

/** Prior-day overdue from the open set — same array the Overdue tab renders. */
export function deriveOverdueItems(
  openItems: readonly TemporalEventListItem[],
  timeZone: string,
  now = new Date(),
): TemporalEventListItem[] {
  return filterPriorDayOverdueItems(openItems, timeZone, now)
}

/**
 * To Do tab list: open items that are not prior-day overdue.
 * Overdue has its own tab — must not appear (or be counted) here.
 */
export function deriveTodoItems(
  openItems: readonly TemporalEventListItem[],
  overdueItems: readonly TemporalEventListItem[],
): TemporalEventListItem[] {
  if (overdueItems.length === 0) return [...openItems]
  const overdueIds = new Set(overdueItems.map((item) => item.id))
  return openItems.filter((item) => !overdueIds.has(item.id))
}

export function deriveTabCounts(input: {
  todoItems: readonly TemporalEventListItem[]
  doneItems: readonly TemporalEventListItem[]
  overdueItems: readonly TemporalEventListItem[]
}): TimelineTabCounts {
  return {
    todo: input.todoItems.length,
    done: input.doneItems.length,
    overdue: input.overdueItems.length,
  }
}

/** Project cards only for projects that have ≥1 open item in the loaded set. */
export function deriveProjectCards(
  openItems: readonly TemporalEventListItem[],
  catalog: readonly ProjectListItem[],
): TimelineProjectCard[] {
  const grouped = groupByProjectEntityId(openItems)
  const byId = new Map(catalog.map((p) => [p.entityId, p]))

  const rows: TimelineProjectCard[] = grouped.groups.map((group) => {
    const catalogRow = byId.get(group.projectEntityId) ?? null
    return {
      entityId: group.projectEntityId,
      label: catalogRow?.label ?? group.projectLabel,
      status: catalogRow?.status ?? 'active',
      catalog: catalogRow,
      group,
    }
  })

  return rows.sort((a, b) => {
    const aLatest =
      a.group.items.length > 0
        ? Math.max(...a.group.items.map((t) => new Date(t.createdAt).getTime()))
        : 0
    const bLatest =
      b.group.items.length > 0
        ? Math.max(...b.group.items.map((t) => new Date(t.createdAt).getTime()))
        : 0
    return bLatest - aLatest
  })
}

export function buildTimelineApiUrl(filters: TimelineFetchFilters): string {
  const params = new URLSearchParams()
  params.set('from', filters.dateRange.from ?? '')
  params.set('to', filters.dateRange.to ?? '')
  params.set('includeUndated', filters.dateRange.includeUndated ? 'true' : 'false')
  params.set('orderBy', filters.orderBy)
  params.set('sortDirection', filters.sortDirection)
  if (filters.dataView === 'user') {
    params.set('author', 'user')
  } else if (filters.dataView === 'all') {
    params.set('author', 'all')
  } else {
    params.set('authorLayerKey', filters.dataView)
  }
  return `/api/timeline?${params}`
}
