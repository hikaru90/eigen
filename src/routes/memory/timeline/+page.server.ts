import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const userId = event.locals.user.id;
	const preferredTimezone = await getUserPreferredTimezone(userId);
	const [pref] = await getDb()
		.select({
			eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
			eventReminderLeadMinutes: userPreference.eventReminderLeadMinutes,
			eventReminderKinds: userPreference.eventReminderKinds
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId))
		.limit(1);

	return {
		user: event.locals.user,
		preferredTimezone,
		eventNotificationsEnabled: pref?.eventNotificationsEnabled ?? false,
		eventReminderLeadMinutes: pref?.eventReminderLeadMinutes ?? 10,
		eventReminderKinds: Array.isArray(pref?.eventReminderKinds)
			? pref.eventReminderKinds
			: ['appointment', 'reminder', 'deadline', 'inferred_event']
	};
};
