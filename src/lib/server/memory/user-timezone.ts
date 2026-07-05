import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';

export type UserEventNotificationPrefs = {
	preferredTimezone: string;
	eventNotificationsEnabled: boolean;
	eventReminderLeadMinutes: number;
	dailySummaryEnabled: boolean;
	dailySummaryMinutesLocal: number;
};

export async function getUserPreferredTimezone(userId: string): Promise<string> {
	const [pref] = await getDb()
		.select({ preferredTimezone: userPreference.preferredTimezone })
		.from(userPreference)
		.where(eq(userPreference.userId, userId))
		.limit(1);

	const fromPref = pref?.preferredTimezone?.trim();
	if (fromPref) return fromPref;

	const fromEnv = process.env.TEMPORAL_ANCHOR_TZ?.trim();
	return fromEnv || 'Europe/Berlin';
}

export async function getUserEventNotificationPrefs(
	userId: string
): Promise<UserEventNotificationPrefs> {
	const [pref] = await getDb()
		.select({
			preferredTimezone: userPreference.preferredTimezone,
			eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
			eventReminderLeadMinutes: userPreference.eventReminderLeadMinutes,
			dailySummaryEnabled: userPreference.dailySummaryEnabled,
			dailySummaryMinutesLocal: userPreference.dailySummaryMinutesLocal
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId))
		.limit(1);

	const preferredTimezone = pref?.preferredTimezone?.trim()
		? pref.preferredTimezone.trim()
		: process.env.TEMPORAL_ANCHOR_TZ?.trim() || 'Europe/Berlin';

	return {
		preferredTimezone,
		eventNotificationsEnabled: pref?.eventNotificationsEnabled ?? false,
		eventReminderLeadMinutes: pref?.eventReminderLeadMinutes ?? 10,
		dailySummaryEnabled: pref?.dailySummaryEnabled ?? false,
		dailySummaryMinutesLocal: pref?.dailySummaryMinutesLocal ?? 480
	};
}
