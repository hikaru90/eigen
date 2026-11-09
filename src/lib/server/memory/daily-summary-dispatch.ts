import { eq } from 'drizzle-orm'
import { getDb, withDbUser } from '$lib/server/db'
import { pushSubscription, userPreference } from '$lib/server/db/schema'
import { loadDailyDigest } from '$lib/server/memory/daily-digest'
import { recordDigestProjectSnapshots } from '$lib/server/memory/daily-digest-projects'
import { dailyDigestPush } from '$lib/server/memory/daily-summary'
import { evaluateDailySummaryDispatch } from '$lib/server/memory/daily-summary-visibility'
import { listDailySummaryCandidates } from '$lib/server/memory/notification-dispatch-admin'
import { localDayKey } from '$lib/server/memory/timeline-today-server'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { queueDigestEmail } from '$lib/server/notify/notification-email'
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

      const digest = await loadDailyDigest(row.userId, timeZone, now)
      const push = dailyDigestPush(digest)

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
        await queueDigestEmail(
          row.userId,
          {
            title: push.title,
            body: push.body,
            url: push.url,
            tag: `daily-summary-${todayKey}`,
          },
          digest,
        )
        await getDb()
          .update(userPreference)
          .set({
            lastDailySummaryLocalDate: todayKey,
            lastDailySummaryDispatchError: null,
            updatedAt: now,
          })
          .where(eq(userPreference.userId, row.userId))
        result.sent += 1
        // The digest is out; remember the next actions so tomorrow's can report changes.
        // A failure here must not turn a delivered digest into a failed one (which
        // would resend it), so it is logged loudly instead.
        try {
          await recordDigestProjectSnapshots(row.userId, digest.projects, now)
        } catch (snapshotErr) {
          console.error('[daily-summary-dispatch] project snapshot write failed', {
            userId: row.userId,
            message: snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr),
          })
        }
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
