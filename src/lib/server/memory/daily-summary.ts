import { countCompletedOnLocalDay, previousLocalDayKey } from '$lib/graph/timeline-completed-today'
import { overdueCount } from '$lib/graph/timeline-overdue'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import { filterOpenTodoTodayItems } from '$lib/server/memory/timeline-today-server'

export type DailySummaryPush = {
  title: string
  body: string
  url: string
}

/** Yesterday's task numbers — kept in the summary as information, not the lead. */
export type YesterdayStats = { completed: number; overdue: number; dueToday: number }

export type DailyDigestProject = { entityId: string; label: string; nextAction: string | null }
export type DailyDigestStalled = { entityId: string; label: string; reason: string }
export type DailyDigestSnippet = { thoughtId: string; snippet: string }
export type DailyDigestAgent = {
  /** Author layer key (view selector / authorLayerKey format). */
  key: string
  label: string
  /** Thoughts this agent captured in the last 24 hours. */
  count: number
  /** Its latest captures, newest first (at most five). */
  recent: DailyDigestSnippet[]
}

/**
 * The daily summary (operator brief, 2026-10-24): what is running (projects), what is
 * stuck (stalled threads), what still needs a thread (open tasks on no project), and
 * what each agent captured — the part that is otherwise invisible. Yesterday's task
 * numbers stay, as information.
 */
export type DailyDigest = {
  yesterday: YesterdayStats
  projects: DailyDigestProject[]
  stalled: DailyDigestStalled[]
  unthreaded: { count: number; recent: DailyDigestSnippet[] }
  agents: DailyDigestAgent[]
}

export function computeYesterdayStats(
  openItems: TemporalEventListItem[],
  allItems: TemporalEventListItem[],
  timeZone: string,
  now = new Date(),
): YesterdayStats {
  const yesterdayKey = previousLocalDayKey(now, timeZone)
  return {
    completed: countCompletedOnLocalDay(allItems, timeZone, yesterdayKey),
    overdue: overdueCount(openItems, now),
    dueToday: filterOpenTodoTodayItems(openItems, now, timeZone).length,
  }
}

function plural(n: number, one: string, other: string): string {
  return `${n} ${n === 1 ? one : other}`
}

/** The push / email headline: one line per section, then yesterday. Opens /summary. */
export function dailyDigestPush(digest: DailyDigest): DailySummaryPush {
  const { yesterday } = digest
  const lead = [
    plural(digest.projects.length, 'active project', 'active projects'),
    digest.stalled.length === 0 ? 'nothing stalled' : `${digest.stalled.length} stalled`,
    digest.unthreaded.count === 0
      ? 'every task has a thread'
      : digest.unthreaded.count === 1
        ? '1 task needs a thread'
        : `${digest.unthreaded.count} tasks need a thread`,
    digest.agents.length === 0
      ? 'No agent captures'
      : `Agents: ${digest.agents.map((a) => `${a.label} ${a.count}`).join(', ')}`,
  ].join(' · ')
  const info = [
    yesterday.completed === 0 ? 'no tasks done' : `${plural(yesterday.completed, 'task', 'tasks')} done`,
    yesterday.overdue === 0 ? 'nothing overdue' : `${yesterday.overdue} overdue`,
    yesterday.dueToday === 0 ? 'nothing due today' : `${yesterday.dueToday} due today`,
  ].join(', ')
  return { title: 'Daily summary', body: `${lead}. Yesterday: ${info}.`, url: '/summary' }
}
