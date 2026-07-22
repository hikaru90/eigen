import { eq } from 'drizzle-orm'
import { getDb, withDbUser } from '$lib/server/db'
import { eventReminderSchedule, pushSubscription } from '$lib/server/db/schema'
import {
  listDueEventReminders,
  type DueEventReminderRow,
} from '$lib/server/memory/notification-dispatch-admin'
import { getUserEventNotificationPrefs } from '$lib/server/memory/user-timezone'
import { sendPushToUser } from '$lib/server/push/send'

const CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000

const KIND_LABELS: Record<string, string> = {
  deadline: 'Deadline',
  appointment: 'Appointment',
  milestone: 'Milestone',
  period: 'Period',
  reminder: 'Reminder',
  inferred_event: 'Event',
}

export type DispatchRemindersResult = {
  processed: number
  sent: number
  skipped: number
  failed: number
}

export async function dispatchDueEventReminders(
  now = new Date(),
): Promise<DispatchRemindersResult> {
  const dueRows = await listDueEventReminders(now)

  const result: DispatchRemindersResult = {
    processed: dueRows.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  }

  for (const row of dueRows) {
    await withDbUser(row.userId, async () => {
      await dispatchOneEventReminder(row, now, result)
    })
  }

  return result
}

async function dispatchOneEventReminder(
  row: DueEventReminderRow,
  now: Date,
  result: DispatchRemindersResult,
): Promise<void> {
  const eventStarted = row.startAt ? row.startAt.getTime() <= now.getTime() : false
  const missedBy = now.getTime() - row.fireAt.getTime()

  if (row.lifecycleStatus !== 'open' || eventStarted) {
    await markSchedule(row.scheduleId, 'skipped')
    result.skipped += 1
    return
  }

  if (missedBy > CATCHUP_WINDOW_MS) {
    await markSchedule(row.scheduleId, 'skipped')
    result.skipped += 1
    return
  }

  const prefs = await getUserEventNotificationPrefs(row.userId)
  if (!prefs.eventNotificationsEnabled) {
    await markSchedule(row.scheduleId, 'skipped')
    result.skipped += 1
    return
  }

  const subs = await getDb()
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, row.userId))
    .limit(1)

  if (subs.length === 0) {
    await markSchedule(row.scheduleId, 'skipped')
    result.skipped += 1
    return
  }

  const title = KIND_LABELS[row.kind] ?? 'Event'
  const body = `In ${row.leadMinutes} min · ${row.semanticSummary}`
  const url = `/memory/timeline?event=${row.temporalEventId}`
  const tag = `event-${row.temporalEventId}-${row.leadMinutes}`

  try {
    await sendPushToUser(row.userId, { title, body, url, tag })
    await markSchedule(row.scheduleId, 'sent')
    result.sent += 1
  } catch (err) {
    console.error('[event-reminder-dispatch] push failed', {
      scheduleId: row.scheduleId,
      message: err instanceof Error ? err.message : String(err),
    })
    await markSchedule(row.scheduleId, 'skipped')
    result.failed += 1
  }
}

async function markSchedule(scheduleId: string, status: 'sent' | 'skipped'): Promise<void> {
  await getDb()
    .update(eventReminderSchedule)
    .set({
      status,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(eventReminderSchedule.id, scheduleId))
}
