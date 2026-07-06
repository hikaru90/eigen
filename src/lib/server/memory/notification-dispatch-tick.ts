import { dispatchDueDailySummaries } from '$lib/server/memory/daily-summary-dispatch';
import { dispatchDueEventReminders } from '$lib/server/memory/event-reminder-dispatch';

export type NotificationDispatchTickResult = {
	eventReminders: Awaited<ReturnType<typeof dispatchDueEventReminders>>;
	dailySummaries: Awaited<ReturnType<typeof dispatchDueDailySummaries>>;
};

let ticking = false;

/** Dispatch due event reminders and daily summaries (same work as POST /api/admin/dispatch-reminders). */
export async function tickNotificationDispatch(): Promise<NotificationDispatchTickResult | null> {
	if (ticking) {
		console.warn('[notification-dispatch] tick skipped — previous tick still running');
		return null;
	}

	ticking = true;
	const startedAt = Date.now();
	try {
		const [eventReminders, dailySummaries] = await Promise.all([
			dispatchDueEventReminders(),
			dispatchDueDailySummaries()
		]);

		const hasActivity =
			eventReminders.sent > 0 ||
			eventReminders.failed > 0 ||
			dailySummaries.sent > 0 ||
			dailySummaries.failed > 0;

		if (hasActivity) {
			console.info('[notification-dispatch] tick', {
				durationMs: Date.now() - startedAt,
				eventReminders,
				dailySummaries
			});
		}

		return { eventReminders, dailySummaries };
	} finally {
		ticking = false;
	}
}
