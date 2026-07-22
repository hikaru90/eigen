import { eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list'
import { sortByFocusRank } from '$lib/server/memory/compute-focus-rank'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

export type WeekPlanSuggestion = {
  eventId: string
  semanticSummary: string
  suggestedStartAt: string
  suggestedEndAt: string
  reason: string
}

export type PlanWeekResult = {
  summary: string
  suggestions: WeekPlanSuggestion[]
  rejectedMinutes: number
}

function weekStartMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(9, 0, 0, 0)
  return d
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
}

export async function planWeekForUser(userId: string): Promise<PlanWeekResult> {
  const now = new Date()
  const timeZone = await getUserPreferredTimezone(userId)

  const [pref] = await getDb()
    .select({ dailyWorkMinutes: userPreference.dailyWorkMinutes })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1)
  const dailyCapacity = pref?.dailyWorkMinutes ?? 480

  const { items } = await listTemporalEventsForUser({
    userId,
    status: 'open',
    range: 'upcoming',
    includeTasks: false,
  })

  const unscheduled = items.filter((i) => i.itemType === 'event' && !i.startAt)
  const ranked = sortByFocusRank(unscheduled, timeZone, now).slice(0, 20)

  const weekStart = weekStartMonday(now)
  const scheduled: { start: number; end: number }[] = []

  for (const item of items) {
    if (!item.startAt) continue
    const start = new Date(item.startAt).getTime()
    const end = item.endAt
      ? new Date(item.endAt).getTime()
      : start + (item.durationMinutes ?? 60) * 60_000
    scheduled.push({ start, end })
  }

  const suggestions: WeekPlanSuggestion[] = []
  let rejectedMinutes = 0

  for (let day = 0; day < 5; day++) {
    let dayUsed = 0
    const dayBase = new Date(weekStart)
    dayBase.setDate(weekStart.getDate() + day)
    let slotHour = 9

    for (const item of ranked) {
      if (suggestions.some((s) => s.eventId === item.id)) continue
      const durationMin = item.durationMinutes ?? 60
      if (dayUsed + durationMin > dailyCapacity) continue

      const slotStart = new Date(dayBase)
      slotStart.setHours(slotHour, 0, 0, 0)
      const slotEnd = new Date(slotStart.getTime() + durationMin * 60_000)
      const slot = { start: slotStart.getTime(), end: slotEnd.getTime() }

      if (scheduled.some((s) => overlaps(s, slot))) {
        slotHour += 1
        if (slotHour > 17) break
        continue
      }

      suggestions.push({
        eventId: item.id,
        semanticSummary: item.semanticSummary,
        suggestedStartAt: slotStart.toISOString(),
        suggestedEndAt: slotEnd.toISOString(),
        reason: 'Open slot matched by focus rank and daily capacity.',
      })
      scheduled.push(slot)
      dayUsed += durationMin
      slotHour += Math.ceil(durationMin / 60)
    }
  }

  for (const item of ranked) {
    if (!suggestions.some((s) => s.eventId === item.id)) {
      rejectedMinutes += item.durationMinutes ?? 60
    }
  }

  const summary =
    suggestions.length > 0
      ? `Proposed ${suggestions.length} slot(s). Review and accept each reschedule — nothing was applied automatically.`
      : rejectedMinutes > 0
        ? `Could not fit remaining work within ${dailyCapacity} min/day capacity.`
        : 'No unscheduled items need planning this week.'

  return { summary, suggestions, rejectedMinutes }
}
