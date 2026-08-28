import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  eventReminderSchedule,
  type TemporalEventKind,
  type TemporalEventLifecycleStatus,
} from '$lib/server/db/schema'
import { getUserEventNotificationPrefs } from '$lib/server/memory/user-timezone'

const CLAMP_DELAY_MS = 60 * 1000

export function computeReminderFireAt(startAt: Date, leadMinutes: number): Date {
  return new Date(startAt.getTime() - leadMinutes * 60 * 1000)
}

function zonedOffsetMs(instant: number, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of dtf.formatToParts(new Date(instant))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const h = parts.hour === 24 ? 0 : parts.hour
  return instant - Date.UTC(parts.year, parts.month - 1, parts.day, h, parts.minute, parts.second)
}

/** Convert a wall-clock time in a timezone to the corresponding UTC instant. */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  // zonedOffsetMs returns -(UTC offset), so add it to go from wall time to instant
  let guess = utcGuess + zonedOffsetMs(utcGuess, timezone)
  guess = utcGuess + zonedOffsetMs(guess, timezone)
  return new Date(guess)
}

/**
 * Default fire time for explicit "remind me" intents without a resolvable time:
 * the next 09:00 in the user's timezone, computed via Intl and stored as UTC.
 */
export function computeExplicitReminderDefaultFireAt(timezone: string, now: Date): Date {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts: Record<string, number> = {}
  for (const p of dtf.formatToParts(now)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value)
  }
  const todayNine = zonedTimeToUtc(parts.year, parts.month, parts.day, 9, 0, timezone)
  if (todayNine.getTime() > now.getTime()) return todayNine
  // Next day: add 24h to the UTC instant, then re-derive that day's local 09:00.
  const nextDay = new Date(todayNine.getTime() + 24 * 60 * 60 * 1000)
  const nextParts: Record<string, number> = {}
  for (const p of dtf.formatToParts(nextDay)) {
    if (p.type !== 'literal') nextParts[p.type] = Number(p.value)
  }
  return zonedTimeToUtc(nextParts.year, nextParts.month, nextParts.day, 9, 0, timezone)
}

async function cancelPending(temporalEventId: string): Promise<void> {
  await getDb()
    .update(eventReminderSchedule)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(
      and(
        eq(eventReminderSchedule.temporalEventId, temporalEventId),
        eq(eventReminderSchedule.status, 'pending'),
      ),
    )
}

async function upsertPending(input: {
  userId: string
  temporalEventId: string
  fireAt: Date
  leadMinutes: number
}): Promise<void> {
  await getDb()
    .insert(eventReminderSchedule)
    .values({
      userId: input.userId,
      temporalEventId: input.temporalEventId,
      fireAt: input.fireAt,
      leadMinutes: input.leadMinutes,
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [eventReminderSchedule.temporalEventId, eventReminderSchedule.leadMinutes],
      set: {
        fireAt: input.fireAt,
        status: 'pending',
        sentAt: null,
        updatedAt: new Date(),
      },
    })
}

/**
 * Upsert or cancel reminder schedule rows for a temporal event.
 *
 * Explicit reminders (kind === 'reminder') are user consent: they are scheduled
 * regardless of the eventNotificationsEnabled pref and never cancelled merely
 * because their fireAt is in the past — the fireAt is clamped to now + 60s so
 * the reminder enters the dispatch queue (which has a 24h catch-up window).
 *
 * Non-reminder kinds are clamped the same way while the event itself is still
 * in the future; they are cancelled only when startAt itself has passed, the
 * lifecycle is not open, or (for non-reminder kinds) the notification pref is
 * disabled.
 */
export async function syncReminderScheduleForEvent(input: {
  userId: string
  temporalEventId: string
  kind: TemporalEventKind | string
  startAt: Date | null
  lifecycleStatus: TemporalEventLifecycleStatus
}): Promise<void> {
  const prefs = await getUserEventNotificationPrefs(input.userId)
  const isExplicitReminder = input.kind === 'reminder'

  // Lifecycle gate applies to everything; the notification pref gate only to
  // non-explicit kinds — an explicit "remind me" IS the consent.
  if (input.lifecycleStatus !== 'open') {
    await cancelPending(input.temporalEventId)
    return
  }
  if (!isExplicitReminder && !prefs.eventNotificationsEnabled) {
    await cancelPending(input.temporalEventId)
    return
  }

  if (!input.startAt) {
    if (!isExplicitReminder) {
      await cancelPending(input.temporalEventId)
      return
    }
    // Explicit reminder without a resolvable time: default to the next 09:00
    // in the user's timezone (stored as UTC) so the intent still produces a reminder.
    await upsertPending({
      userId: input.userId,
      temporalEventId: input.temporalEventId,
      fireAt: computeExplicitReminderDefaultFireAt(prefs.preferredTimezone, new Date()),
      leadMinutes: prefs.eventReminderLeadMinutes,
    })
    return
  }

  const fireAt = computeReminderFireAt(input.startAt, prefs.eventReminderLeadMinutes)
  const now = new Date()

  if (fireAt.getTime() <= now.getTime()) {
    // Past fireAt: never silently cancel. Reminders always clamp into the queue;
    // other kinds clamp only while the event itself is still ahead.
    const eventStillFuture = input.startAt.getTime() > now.getTime()
    if (isExplicitReminder || eventStillFuture) {
      await upsertPending({
        userId: input.userId,
        temporalEventId: input.temporalEventId,
        fireAt: new Date(now.getTime() + CLAMP_DELAY_MS),
        leadMinutes: prefs.eventReminderLeadMinutes,
      })
      return
    }
    await cancelPending(input.temporalEventId)
    return
  }

  await upsertPending({
    userId: input.userId,
    temporalEventId: input.temporalEventId,
    fireAt,
    leadMinutes: prefs.eventReminderLeadMinutes,
  })
}

export async function cancelReminderSchedulesForEvent(temporalEventId: string): Promise<void> {
  await cancelPending(temporalEventId)
}
