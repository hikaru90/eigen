import { eq } from 'drizzle-orm'
import { getDb, withDbUser } from '$lib/server/db'
import { pushSubscription, userPreference } from '$lib/server/db/schema'
import {
  buildDailySummaryPreviewForUser,
  evaluateDailySummaryDispatch,
} from '$lib/server/memory/daily-summary-visibility'
import { listDailySummaryCandidates } from '$lib/server/memory/notification-dispatch-admin'
import { localDayKey } from '$lib/server/memory/timeline-today-server'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { queueNotificationEmail } from '$lib/server/notify/notification-email'
import { sendPushToUser } from '$lib/server/push/send'

export type DispatchDailySummariesResult = {
  processed: number
  sent: number
  skipped: number
  failed: number
}

export async function dispatchDueDailySummaries(
  now = new Date(),
): Promise<DispatchDailySummariesResult> {
  const rows = await listDailySummaryCandidates()

  const result: DispatchDailySummariesResult = {
    processed: rows.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  }

  for (const row of rows) {
    await withDbUser(row.userId, async () => {
      const [pref] = await getDb()
        .select({
          dailySummaryMinutesLocal: userPreference.dailySummaryMinutesLocal,
          lastDailySummaryLocalDate: userPreference.lastDailySummaryLocalDate,
          lastDailySummaryDispatchError: userPreference.lastDailySummaryDispatchError,
        })
        .from(userPreference)
        .where(eq(userPreference.userId, row.userId))
        .limit(1)

      const timeZone = await getUserPreferredTimezone(row.userId)
      const todayKey = localDayKey(now.toISOString(), timeZone)

      const subs = await getDb()
        .select({ id: pushSubscription.id })
        .from(pushSubscription)
        .where(eq(pushSubscription.userId, row.userId))
      const evaluation = evaluateDailySummaryDispatch({
        now,
        timeZone,
        dailySummaryMinutesLocal: pref?.dailySummaryMinutesLocal ?? row.dailySummaryMinutesLocal,
        lastDailySummaryLocalDate: pref?.lastDailySummaryLocalDate ?? null,
        lastDailySummaryDispatchError: pref?.lastDailySummaryDispatchError ?? null,
        pushDeviceCount: subs.length,
      })
      if (!evaluation.wouldDispatch) {
        result.skipped += 1
        return
      }

      const push = await buildDailySummaryPreviewForUser(row.userId, now)

      try {
        const pushResult = await sendPushToUser(row.userId, {
          title: push.title,
          body: push.body,
          url: push.url,
          tag: `daily-summary-${todayKey}`,
        })
        if (pushResult.sent < 1) {
          throw new Error('Push delivery failed: no device accepted the notification')
        }
        await queueNotificationEmail(row.userId, {
          title: push.title,
          body: push.body,
          url: push.url,
          tag: `daily-summary-${todayKey}`,
        })
        await getDb()
          .update(userPreference)
          .set({
            lastDailySummaryLocalDate: todayKey,
            lastDailySummaryDispatchError: null,
            updatedAt: now,
          })
          .where(eq(userPreference.userId, row.userId))
        result.sent += 1
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[daily-summary-dispatch] push failed', {
          userId: row.userId,
          message,
        })
        await getDb()
          .update(userPreference)
          .set({
            lastDailySummaryLocalDate: null,
            lastDailySummaryDispatchError: message,
            updatedAt: now,
          })
          .where(eq(userPreference.userId, row.userId))
        result.failed += 1
      }
    })
  }

  return result
}
