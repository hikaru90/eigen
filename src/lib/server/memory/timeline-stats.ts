import { and, eq, gte, lte } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { temporalEvent, thought } from '$lib/server/db/schema'
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list'
import { priorDayOverdueCount, overdueDebtMinutes } from '$lib/graph/timeline-overdue'
import { completedTodayCount } from '$lib/graph/timeline-completed-today'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { filterOpenTodoTodayItems } from '$lib/server/memory/timeline-today-server'
import type { MemoryAuthor } from '$lib/server/db/brain.schema'

export type TimelineStats = {
  completionsThisWeek: number
  streakDays: number
  overdueDebtMinutes: number
  overdueCount: number
  todoTodayCount: number
  doneTodayCount: number
  estimatedMinutesToday: number
}

export type TimelineStatsQuery = {
  userId: string
  from?: string | null
  to?: string | null
  includeUndated?: boolean
  author?: MemoryAuthor
  authorLayerKey?: string | null
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function localDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Compute consecutive completion streak from completion instants (server-local calendar days). */
export function computeStreakDaysFromCompletions(
  completionAts: readonly Date[],
  now: Date,
  maxDays = 30,
): number {
  const daysWithCompletion = new Set(completionAts.map((at) => localDayKey(at)))
  let streakDays = 0
  for (let offset = 0; offset < maxDays; offset++) {
    const day = new Date(now)
    day.setDate(now.getDate() - offset)
    if (!daysWithCompletion.has(localDayKey(day))) break
    streakDays += 1
  }
  return streakDays
}

export async function computeTimelineStatsForUser(
  input: string | TimelineStatsQuery,
): Promise<TimelineStats> {
  const query: TimelineStatsQuery = typeof input === 'string' ? { userId: input } : input
  const { userId } = query
  const now = new Date()
  const timeZone = await getUserPreferredTimezone(userId)
  const weekStart = startOfWeek(now)
  const streakWindowStart = startOfLocalDay(now)
  streakWindowStart.setDate(streakWindowStart.getDate() - 29)
  const from = query.from !== undefined ? query.from : null
  const to = query.to !== undefined ? query.to : null
  const includeUndated = query.includeUndated !== undefined ? query.includeUndated : true

  // One windowed query each for events + tasks covering the streak lookback;
  // week completions and streak are derived in-process (no per-day loop).
  const [eventCompletions, taskCompletions] = await Promise.all([
    getDb()
      .select({ at: temporalEvent.lifecycleUpdatedAt })
      .from(temporalEvent)
      .where(
        and(
          eq(temporalEvent.userId, userId),
          eq(temporalEvent.lifecycleStatus, 'completed'),
          gte(temporalEvent.lifecycleUpdatedAt, streakWindowStart),
          lte(temporalEvent.lifecycleUpdatedAt, now),
        ),
      ),
    getDb()
      .select({ at: thought.lifecycleUpdatedAt })
      .from(thought)
      .where(
        and(
          eq(thought.userId, userId),
          eq(thought.category, 'task'),
          eq(thought.lifecycleStatus, 'completed'),
          gte(thought.lifecycleUpdatedAt, streakWindowStart),
          lte(thought.lifecycleUpdatedAt, now),
        ),
      ),
  ])

  const completionAts = [...eventCompletions, ...taskCompletions]
    .map((r) => r.at)
    .filter((at): at is Date => at instanceof Date)

  const completionsThisWeek = completionAts.filter((at) => at >= weekStart && at <= now).length
  const streakDays = computeStreakDaysFromCompletions(completionAts, now)

  const { items: allItems } = await listTemporalEventsForUser({
    userId,
    includeTasks: true,
    from,
    to,
    includeUndated,
    author: query.author,
    authorLayerKey: query.authorLayerKey,
    status: 'all',
  })

  const openItems = allItems.filter((item) => item.lifecycleStatus === 'open')
  const todoToday = filterOpenTodoTodayItems(openItems, now, timeZone)

  return {
    completionsThisWeek,
    streakDays,
    overdueDebtMinutes: overdueDebtMinutes(openItems, now),
    overdueCount: priorDayOverdueCount(openItems, timeZone, now),
    todoTodayCount: todoToday.length,
    doneTodayCount: completedTodayCount(allItems, timeZone, now),
    estimatedMinutesToday: todoToday.reduce((sum, item) => sum + (item.durationMinutes ?? 30), 0),
  }
}
