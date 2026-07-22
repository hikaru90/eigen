import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  eventReminderSchedule,
  pushSubscription,
  userJobQueue,
  userPreference,
} from '$lib/server/db/schema'
import {
  buildDailySummaryPreviewForUser,
  dailySummaryDispatchReasonLabel,
  evaluateDailySummaryDispatch,
  type DailySummaryDispatchEvaluation,
  type DailySummaryPreview,
} from '$lib/server/memory/daily-summary-visibility'
import { formatMinutesLocal } from '$lib/server/memory/timeline-today-server'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { loadPushHealthSnapshot } from '$lib/server/push/health'

export type NotificationStatus = {
  at: string
  serverPushReady: boolean
  pushDevicesRegistered: number
  eventNotificationsEnabled: boolean
  dailySummaryEnabled: boolean
  dailySummary: {
    scheduledTimeLocal: string
    timeZone: string
    lastSentLocalDate: string | null
    lastDispatchError: string | null
    dispatch: DailySummaryDispatchEvaluation
    statusLabel: string
    preview: DailySummaryPreview | null
  }
  reminders: {
    pending: number
    dueNow: number
    nextFireAt: string | null
    lastDispatch: {
      status: string
      sentAt: string | null
      fireAt: string
    } | null
  }
  jobQueue: {
    pending: number
    running: number
    failed: number
  }
}

export async function loadNotificationStatusForUser(userId: string): Promise<NotificationStatus> {
  const push = loadPushHealthSnapshot()

  const [pref] = await getDb()
    .select({
      eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
      dailySummaryEnabled: userPreference.dailySummaryEnabled,
      dailySummaryMinutesLocal: userPreference.dailySummaryMinutesLocal,
      lastDailySummaryLocalDate: userPreference.lastDailySummaryLocalDate,
      lastDailySummaryDispatchError: userPreference.lastDailySummaryDispatchError,
    })
    .from(userPreference)
    .where(eq(userPreference.userId, userId))
    .limit(1)

  const pushRows = await getDb()
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, userId))

  const now = new Date()
  const timeZone = await getUserPreferredTimezone(userId)
  const dailySummaryMinutesLocal = pref?.dailySummaryMinutesLocal ?? 480
  const dailySummaryDispatch = evaluateDailySummaryDispatch({
    now,
    timeZone,
    dailySummaryMinutesLocal,
    lastDailySummaryLocalDate: pref?.lastDailySummaryLocalDate ?? null,
    lastDailySummaryDispatchError: pref?.lastDailySummaryDispatchError ?? null,
    pushDeviceCount: pushRows.length,
  })
  const dailySummaryPreview =
    pref?.dailySummaryEnabled === true ? await buildDailySummaryPreviewForUser(userId, now) : null

  const [pendingRow] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(eventReminderSchedule)
    .where(
      and(eq(eventReminderSchedule.userId, userId), eq(eventReminderSchedule.status, 'pending')),
    )

  const [dueRow] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(eventReminderSchedule)
    .where(
      and(
        eq(eventReminderSchedule.userId, userId),
        eq(eventReminderSchedule.status, 'pending'),
        lte(eventReminderSchedule.fireAt, sql`now()`),
      ),
    )

  const [nextRow] = await getDb()
    .select({ fireAt: eventReminderSchedule.fireAt })
    .from(eventReminderSchedule)
    .where(
      and(eq(eventReminderSchedule.userId, userId), eq(eventReminderSchedule.status, 'pending')),
    )
    .orderBy(eventReminderSchedule.fireAt)
    .limit(1)

  const [lastDispatchRow] = await getDb()
    .select({
      status: eventReminderSchedule.status,
      sentAt: eventReminderSchedule.sentAt,
      fireAt: eventReminderSchedule.fireAt,
    })
    .from(eventReminderSchedule)
    .where(
      and(
        eq(eventReminderSchedule.userId, userId),
        inArray(eventReminderSchedule.status, ['sent', 'skipped']),
      ),
    )
    .orderBy(desc(eventReminderSchedule.sentAt))
    .limit(1)

  const jobCounts = await getDb()
    .select({
      status: userJobQueue.status,
      count: sql<number>`count(*)::int`,
    })
    .from(userJobQueue)
    .where(eq(userJobQueue.userId, userId))
    .groupBy(userJobQueue.status)

  const jobQueue = { pending: 0, running: 0, failed: 0 }
  for (const row of jobCounts) {
    if (row.status === 'pending') jobQueue.pending = row.count
    if (row.status === 'running') jobQueue.running = row.count
    if (row.status === 'failed') jobQueue.failed = row.count
  }

  return {
    at: new Date().toISOString(),
    serverPushReady: push.vapidConfigured,
    pushDevicesRegistered: pushRows.length,
    eventNotificationsEnabled: pref?.eventNotificationsEnabled ?? false,
    dailySummaryEnabled: pref?.dailySummaryEnabled ?? false,
    dailySummary: {
      scheduledTimeLocal: formatMinutesLocal(dailySummaryMinutesLocal),
      timeZone,
      lastSentLocalDate: pref?.lastDailySummaryLocalDate ?? null,
      lastDispatchError: pref?.lastDailySummaryDispatchError ?? null,
      dispatch: dailySummaryDispatch,
      statusLabel: dailySummaryDispatchReasonLabel(
        dailySummaryDispatch.reason,
        dailySummaryDispatch.lastDispatchError,
      ),
      preview: dailySummaryPreview,
    },
    reminders: {
      pending: pendingRow?.count ?? 0,
      dueNow: dueRow?.count ?? 0,
      nextFireAt: nextRow?.fireAt?.toISOString() ?? null,
      lastDispatch: lastDispatchRow
        ? {
            status: lastDispatchRow.status,
            sentAt: lastDispatchRow.sentAt?.toISOString() ?? null,
            fireAt: lastDispatchRow.fireAt.toISOString(),
          }
        : null,
    },
    jobQueue,
  }
}
