import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import { filterPriorDayOverdueItems, isScheduledForToday } from '$lib/graph/timeline-overdue'

export function localDayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export function localMinutesSinceMidnight(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

export function formatMinutesLocal(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseTimeLocalToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hour = Number.parseInt(match[1], 10)
  const minute = Number.parseInt(match[2], 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return hour * 60 + minute
}

export function isOpenTodoToday(item: TemporalEventListItem, now: Date, timeZone: string): boolean {
  if (item.lifecycleStatus === 'completed' || item.thoughtStatus === 'completed') return false
  if (item.snoozedUntil && new Date(item.snoozedUntil).getTime() > now.getTime()) return false
  return isScheduledForToday(item, timeZone, now)
}

/** Today's open todo list: scheduled for today plus prior-day overdue (matches timeline todo tab). */
export function filterOpenTodoTodayItems(
  items: TemporalEventListItem[],
  now: Date,
  timeZone: string,
): TemporalEventListItem[] {
  const todoToday = items.filter((item) => isOpenTodoToday(item, now, timeZone))
  const seen = new Set(todoToday.map((item) => item.id))
  for (const item of filterPriorDayOverdueItems(items, timeZone, now)) {
    if (!seen.has(item.id)) {
      todoToday.push(item)
      seen.add(item.id)
    }
  }
  return todoToday
}
