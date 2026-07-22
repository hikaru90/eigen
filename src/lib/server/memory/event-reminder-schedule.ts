import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  eventReminderSchedule,
  type TemporalEventKind,
  type TemporalEventLifecycleStatus,
} from '$lib/server/db/schema'
import { getUserEventNotificationPrefs } from '$lib/server/memory/user-timezone'

export function computeReminderFireAt(startAt: Date, leadMinutes: number): Date {
  return new Date(startAt.getTime() - leadMinutes * 60 * 1000)
}

/**
 * Upsert or cancel reminder schedule rows for a temporal event.
 */
export async function syncReminderScheduleForEvent(input: {
  userId: string
  temporalEventId: string
  kind: TemporalEventKind | string
  startAt: Date | null
  lifecycleStatus: TemporalEventLifecycleStatus
}): Promise<void> {
  const db = getDb()
  const prefs = await getUserEventNotificationPrefs(input.userId)

  const shouldSchedule =
    input.lifecycleStatus === 'open' && input.startAt !== null && prefs.eventNotificationsEnabled

  if (!shouldSchedule) {
    await db
      .update(eventReminderSchedule)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(eventReminderSchedule.temporalEventId, input.temporalEventId),
          eq(eventReminderSchedule.status, 'pending'),
        ),
      )
    return
  }

  const fireAt = computeReminderFireAt(input.startAt!, prefs.eventReminderLeadMinutes)
  const now = new Date()

  if (fireAt.getTime() <= now.getTime()) {
    await db
      .update(eventReminderSchedule)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(eventReminderSchedule.temporalEventId, input.temporalEventId),
          eq(eventReminderSchedule.status, 'pending'),
        ),
      )
    return
  }

  await db
    .insert(eventReminderSchedule)
    .values({
      userId: input.userId,
      temporalEventId: input.temporalEventId,
      fireAt,
      leadMinutes: prefs.eventReminderLeadMinutes,
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [eventReminderSchedule.temporalEventId, eventReminderSchedule.leadMinutes],
      set: {
        fireAt,
        status: 'pending',
        sentAt: null,
        updatedAt: new Date(),
      },
    })
}

export async function cancelReminderSchedulesForEvent(temporalEventId: string): Promise<void> {
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
