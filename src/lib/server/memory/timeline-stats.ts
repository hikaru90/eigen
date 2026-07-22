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

export async function computeTimelineStatsForUser(
  input: string | TimelineStatsQuery,
): Promise<TimelineStats> {
  const query: TimelineStatsQuery = typeof input === 'string' ? { userId: input } : input
  const { userId } = query
  const now = new Date()
  const timeZone = await getUserPreferredTimezone(userId)
  const weekStart = startOfWeek(now)
  const from = query.from !== undefined ? query.from : null
  const to = query.to !== undefined ? query.to : null
  const includeUndated = query.includeUndated !== undefined ? query.includeUndated : true

  const eventCompletions = await getDb()
    .select({ id: temporalEvent.id })
    .from(temporalEvent)
    .where(
      and(
        eq(temporalEvent.userId, userId),
        eq(temporalEvent.lifecycleStatus, 'completed'),
        gte(temporalEvent.lifecycleUpdatedAt, weekStart),
        lte(temporalEvent.lifecycleUpdatedAt, now),
      ),
    )

  const taskCompletions = await getDb()
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        eq(thought.category, 'task'),
        eq(thought.lifecycleStatus, 'completed'),
        gte(thought.lifecycleUpdatedAt, weekStart),
        lte(thought.lifecycleUpdatedAt, now),
      ),
    )

  const completionsThisWeek = [...eventCompletions, ...taskCompletions]

  let streakDays = 0
  for (let offset = 0; offset < 30; offset++) {
    const dayStart = new Date(now)
    dayStart.setDate(now.getDate() - offset)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(dayStart)
    dayEnd.setHours(23, 59, 59, 999)

    const eventRows = await getDb()
      .select({ id: temporalEvent.id })
      .from(temporalEvent)
      .where(
        and(
          eq(temporalEvent.userId, userId),
          eq(temporalEvent.lifecycleStatus, 'completed'),
          gte(temporalEvent.lifecycleUpdatedAt, dayStart),
          lte(temporalEvent.lifecycleUpdatedAt, dayEnd),
        ),
      )
      .limit(1)

    const taskRows =
      eventRows.length === 0
        ? await getDb()
            .select({ id: thought.id })
            .from(thought)
            .where(
              and(
                eq(thought.userId, userId),
                eq(thought.category, 'task'),
                eq(thought.lifecycleStatus, 'completed'),
                gte(thought.lifecycleUpdatedAt, dayStart),
                lte(thought.lifecycleUpdatedAt, dayEnd),
              ),
            )
            .limit(1)
        : []

    const rows = eventRows.length > 0 ? eventRows : taskRows

    if (rows.length === 0) break
    streakDays += 1
  }

  const listBase = {
    userId,
    includeTasks: true as const,
    from,
    to,
    includeUndated,
    author: query.author,
    authorLayerKey: query.authorLayerKey,
  }

  const { items: openItems } = await listTemporalEventsForUser({
    ...listBase,
    status: 'open',
  })

  const { items: allItems } = await listTemporalEventsForUser({
    ...listBase,
    status: 'all',
  })

  const todoToday = filterOpenTodoTodayItems(openItems, now, timeZone)

  return {
    completionsThisWeek: completionsThisWeek.length,
    streakDays,
    overdueDebtMinutes: overdueDebtMinutes(openItems, now),
    overdueCount: priorDayOverdueCount(openItems, timeZone, now),
    todoTodayCount: todoToday.length,
    doneTodayCount: completedTodayCount(allItems, timeZone, now),
    estimatedMinutesToday: todoToday.reduce((sum, item) => sum + (item.durationMinutes ?? 30), 0),
  }
}
