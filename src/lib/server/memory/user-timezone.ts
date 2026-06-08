import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';

const DEFAULT_REMINDER_KINDS = ['appointment', 'reminder', 'deadline'] as const;

export type UserEventNotificationPrefs = {
	preferredTimezone: string;
	eventNotificationsEnabled: boolean;
	eventReminderLeadMinutes: number;
	eventReminderKinds: string[];
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
	return fromEnv || 'UTC';
}

export async function getUserEventNotificationPrefs(
	userId: string
): Promise<UserEventNotificationPrefs> {
	const [pref] = await getDb()
		.select({
			preferredTimezone: userPreference.preferredTimezone,
			eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
			eventReminderLeadMinutes: userPreference.eventReminderLeadMinutes,
			eventReminderKinds: userPreference.eventReminderKinds
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId))
		.limit(1);

	const preferredTimezone = pref?.preferredTimezone?.trim()
		? pref.preferredTimezone.trim()
		: process.env.TEMPORAL_ANCHOR_TZ?.trim() || 'UTC';

	const kinds = Array.isArray(pref?.eventReminderKinds)
		? pref.eventReminderKinds.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
		: [...DEFAULT_REMINDER_KINDS];

	return {
		preferredTimezone,
		eventNotificationsEnabled: pref?.eventNotificationsEnabled ?? false,
		eventReminderLeadMinutes: pref?.eventReminderLeadMinutes ?? 10,
		eventReminderKinds: kinds.length > 0 ? kinds : [...DEFAULT_REMINDER_KINDS]
	};
}
