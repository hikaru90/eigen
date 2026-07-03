import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { pushSubscription, userPreference } from '$lib/server/db/schema';
import { buildDailySummaryPush } from '$lib/server/memory/daily-summary';
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list';
import {
	localDayKey,
	localMinutesSinceMidnight
} from '$lib/server/memory/timeline-today-server';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';
import { sendPushToUser } from '$lib/server/push/send';

const DISPATCH_WINDOW_MINUTES = 10;

export type DispatchDailySummariesResult = {
	processed: number;
	sent: number;
	skipped: number;
	failed: number;
};

export async function dispatchDueDailySummaries(
	now = new Date()
): Promise<DispatchDailySummariesResult> {
	const rows = await getDb()
		.select({
			userId: userPreference.userId,
			dailySummaryEnabled: userPreference.dailySummaryEnabled,
			dailySummaryMinutesLocal: userPreference.dailySummaryMinutesLocal,
			lastDailySummaryLocalDate: userPreference.lastDailySummaryLocalDate,
			eventNotificationsEnabled: userPreference.eventNotificationsEnabled
		})
		.from(userPreference)
		.where(
			and(
				eq(userPreference.dailySummaryEnabled, true),
				eq(userPreference.eventNotificationsEnabled, true)
			)
		);

	const result: DispatchDailySummariesResult = {
		processed: rows.length,
		sent: 0,
		skipped: 0,
		failed: 0
	};

	for (const row of rows) {
		const timeZone = await getUserPreferredTimezone(row.userId);
		const todayKey = localDayKey(now.toISOString(), timeZone);
		if (row.lastDailySummaryLocalDate === todayKey) {
			result.skipped += 1;
			continue;
		}

		const currentMinutes = localMinutesSinceMidnight(now, timeZone);
		const targetMinutes = row.dailySummaryMinutesLocal;
		if (
			currentMinutes < targetMinutes ||
			currentMinutes >= targetMinutes + DISPATCH_WINDOW_MINUTES
		) {
			result.skipped += 1;
			continue;
		}

		const subs = await getDb()
			.select({ id: pushSubscription.id })
			.from(pushSubscription)
			.where(eq(pushSubscription.userId, row.userId))
			.limit(1);
		if (subs.length === 0) {
			result.skipped += 1;
			continue;
		}

		const { items } = await listTemporalEventsForUser({
			userId: row.userId,
			status: 'open',
			range: 'all',
			includeTasks: true
		});
		const push = buildDailySummaryPush(items, timeZone, now);

		try {
			await sendPushToUser(row.userId, {
				title: push.title,
				body: push.body,
				url: '/memory/timeline',
				tag: `daily-summary-${todayKey}`
			});
			await getDb()
				.update(userPreference)
				.set({ lastDailySummaryLocalDate: todayKey, updatedAt: now })
				.where(eq(userPreference.userId, row.userId));
			result.sent += 1;
		} catch (err) {
			console.error('[daily-summary-dispatch] push failed', {
				userId: row.userId,
				message: err instanceof Error ? err.message : String(err)
			});
			result.failed += 1;
		}
	}

	return result;
}
