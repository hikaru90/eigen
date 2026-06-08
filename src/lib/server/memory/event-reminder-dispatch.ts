import { and, eq, lte } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	eventReminderSchedule,
	temporalEvent,
	pushSubscription
} from '$lib/server/db/schema';
import { sendPushToUser } from '$lib/server/push/send';
import { getUserEventNotificationPrefs } from '$lib/server/memory/user-timezone';

const CATCHUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const KIND_LABELS: Record<string, string> = {
	deadline: 'Deadline',
	appointment: 'Appointment',
	milestone: 'Milestone',
	period: 'Period',
	reminder: 'Reminder',
	inferred_event: 'Event'
};

export type DispatchRemindersResult = {
	processed: number;
	sent: number;
	skipped: number;
	failed: number;
};

export async function dispatchDueEventReminders(now = new Date()): Promise<DispatchRemindersResult> {
	const dueRows = await getDb()
		.select({
			scheduleId: eventReminderSchedule.id,
			userId: eventReminderSchedule.userId,
			temporalEventId: eventReminderSchedule.temporalEventId,
			fireAt: eventReminderSchedule.fireAt,
			leadMinutes: eventReminderSchedule.leadMinutes,
			kind: temporalEvent.kind,
			semanticSummary: temporalEvent.semanticSummary,
			startAt: temporalEvent.startAt,
			lifecycleStatus: temporalEvent.lifecycleStatus
		})
		.from(eventReminderSchedule)
		.innerJoin(temporalEvent, eq(eventReminderSchedule.temporalEventId, temporalEvent.id))
		.where(
			and(
				eq(eventReminderSchedule.status, 'pending'),
				lte(eventReminderSchedule.fireAt, now)
			)
		)
		.limit(200);

	const result: DispatchRemindersResult = {
		processed: dueRows.length,
		sent: 0,
		skipped: 0,
		failed: 0
	};

	for (const row of dueRows) {
		const eventStarted = row.startAt ? row.startAt.getTime() <= now.getTime() : false;
		const missedBy = now.getTime() - row.fireAt.getTime();

		if (row.lifecycleStatus !== 'open' || eventStarted) {
			await markSchedule(row.scheduleId, 'skipped');
			result.skipped += 1;
			continue;
		}

		if (missedBy > CATCHUP_WINDOW_MS) {
			await markSchedule(row.scheduleId, 'skipped');
			result.skipped += 1;
			continue;
		}

		const prefs = await getUserEventNotificationPrefs(row.userId);
		if (!prefs.eventNotificationsEnabled || !prefs.eventReminderKinds.includes(row.kind)) {
			await markSchedule(row.scheduleId, 'skipped');
			result.skipped += 1;
			continue;
		}

		const subs = await getDb()
			.select({ id: pushSubscription.id })
			.from(pushSubscription)
			.where(eq(pushSubscription.userId, row.userId))
			.limit(1);

		if (subs.length === 0) {
			await markSchedule(row.scheduleId, 'skipped');
			result.skipped += 1;
			continue;
		}

		const title = KIND_LABELS[row.kind] ?? 'Event';
		const body = `In ${row.leadMinutes} min · ${row.semanticSummary}`;
		const url = `/graph?tab=temporal&event=${row.temporalEventId}`;
		const tag = `event-${row.temporalEventId}-${row.leadMinutes}`;

		try {
			await sendPushToUser(row.userId, { title, body, url, tag });
			await markSchedule(row.scheduleId, 'sent');
			result.sent += 1;
		} catch (err) {
			console.error('[event-reminder-dispatch] push failed', {
				scheduleId: row.scheduleId,
				message: err instanceof Error ? err.message : String(err)
			});
			await markSchedule(row.scheduleId, 'skipped');
			result.failed += 1;
		}
	}

	return result;
}

async function markSchedule(
	scheduleId: string,
	status: 'sent' | 'skipped'
): Promise<void> {
	await getDb()
		.update(eventReminderSchedule)
		.set({
			status,
			sentAt: new Date(),
			updatedAt: new Date()
		})
		.where(eq(eventReminderSchedule.id, scheduleId));
}
