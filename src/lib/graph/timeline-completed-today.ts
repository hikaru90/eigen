import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import { isTimelineItemCompleted } from '$lib/graph/timeline-overdue'

function localDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

/** Best-effort instant when the item was marked complete (for "done today" grouping). */
export function completionInstantIso(item: TemporalEventListItem): string | null {
  if (!isTimelineItemCompleted(item)) return null
  if (item.completedAt) return item.completedAt
  if (item.lifecycleUpdatedAt) return item.lifecycleUpdatedAt
  return null
}

export function isCompletedToday(
  item: TemporalEventListItem,
  timeZone: string,
  now = new Date(),
): boolean {
  const instant = completionInstantIso(item)
  if (!instant) return false
  return localDayKey(instant, timeZone) === localDayKey(now.toISOString(), timeZone)
}

export function isCompletedOnLocalDay(
  item: TemporalEventListItem,
  timeZone: string,
  dayKey: string,
): boolean {
  const instant = completionInstantIso(item)
  if (!instant) return false
  return localDayKey(instant, timeZone) === dayKey
}

export function countCompletedOnLocalDay(
  items: TemporalEventListItem[],
  timeZone: string,
  dayKey: string,
): number {
  return items.filter((item) => isCompletedOnLocalDay(item, timeZone, dayKey)).length
}

/** Local calendar day key (YYYY-MM-DD) for the day before `now` in `timeZone`. */
export function previousLocalDayKey(now: Date, timeZone: string): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  return localDayKey(yesterday.toISOString(), timeZone)
}

export function filterCompletedTodayItems(
  items: TemporalEventListItem[],
  timeZone: string,
  now = new Date(),
): TemporalEventListItem[] {
  return items.filter((item) => isCompletedToday(item, timeZone, now))
}

export function completedTodayCount(
  items: TemporalEventListItem[],
  timeZone: string,
  now = new Date(),
): number {
  return filterCompletedTodayItems(items, timeZone, now).length
}
