import { countCompletedOnLocalDay, previousLocalDayKey } from '$lib/graph/timeline-completed-today'
import { overdueCount } from '$lib/graph/timeline-overdue'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import { filterOpenTodoTodayItems } from '$lib/server/memory/timeline-today-server'

export type DailySummaryPush = {
  title: string
  body: string
  url: string
}

function formatCompletedYesterday(count: number): string {
  if (count === 0) return 'You did not finish any tasks yesterday.'
  if (count === 1) return 'You completed 1 task yesterday.'
  return `You completed ${count} tasks yesterday.`
}

function formatOverdue(count: number): string {
  if (count === 0) return 'Nothing overdue.'
  if (count === 1) return '1 overdue task.'
  return `${count} overdue tasks.`
}

function formatDueToday(count: number): string {
  if (count === 0) return 'Nothing due today.'
  if (count === 1) return '1 due today.'
  return `${count} due today.`
}

export function buildDailySummaryPush(
  openItems: TemporalEventListItem[],
  allItems: TemporalEventListItem[],
  timeZone: string,
  now = new Date(),
): DailySummaryPush {
  const yesterdayKey = previousLocalDayKey(now, timeZone)
  const completedYesterday = countCompletedOnLocalDay(allItems, timeZone, yesterdayKey)
  const overdue = overdueCount(openItems, now)
  const dueToday = filterOpenTodoTodayItems(openItems, now, timeZone).length

  const body = [
    formatCompletedYesterday(completedYesterday),
    formatOverdue(overdue),
    formatDueToday(dueToday),
    'Tap to open your timeline.',
  ].join(' ')

  return {
    title: 'Daily summary',
    body,
    url: overdue > 0 ? '/memory/tasks?segment=overdue' : '/memory/tasks',
  }
}
