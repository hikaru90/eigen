import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { temporalEvent } from '$lib/server/db/schema'
import { syncReminderScheduleForEvent } from '$lib/server/memory/event-reminder-schedule'

/** Rebuild pending reminder rows for all open scheduled events (after prefs change). */
export async function resyncAllReminderSchedulesForUser(userId: string): Promise<number> {
  const rows = await getDb()
    .select({
      id: temporalEvent.id,
      kind: temporalEvent.kind,
      startAt: temporalEvent.startAt,
      lifecycleStatus: temporalEvent.lifecycleStatus,
    })
    .from(temporalEvent)
    .where(
      and(
        eq(temporalEvent.userId, userId),
        eq(temporalEvent.lifecycleStatus, 'open'),
        isNotNull(temporalEvent.startAt),
      ),
    )

  for (const row of rows) {
    await syncReminderScheduleForEvent({
      userId,
      temporalEventId: row.id,
      kind: row.kind,
      startAt: row.startAt,
      lifecycleStatus: row.lifecycleStatus,
    })
  }

  return rows.length
}
