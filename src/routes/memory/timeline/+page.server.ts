import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	const userId = event.locals.user.id;

	// Register dependency on temporal events and thoughts for invalidation
	event.depends('timeline:temporal-events', 'timeline:thoughts');

	const [preferredTimezoneResult, prefResult, temporalEventsResult] = await Promise.all([
		getUserPreferredTimezone(userId),
		getDb()
			.select({
				eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
				eventReminderLeadMinutes: userPreference.eventReminderLeadMinutes,
				eventReminderKinds: userPreference.eventReminderKinds
			})
			.from(userPreference)
			.where(eq(userPreference.userId, userId))
			.limit(1),
		listTemporalEventsForUser({
			userId,
			range: 'relevant',
			status: 'open',
			includeTasks: true,
			orderBy: 'todo',
			sortDirection: 'desc'
		})
	]);

	const pref = prefResult[0];

	return {
		user: event.locals.user,
		preferredTimezone: preferredTimezoneResult,
		eventNotificationsEnabled: pref?.eventNotificationsEnabled ?? false,
		eventReminderLeadMinutes: pref?.eventReminderLeadMinutes ?? 10,
		eventReminderKinds: Array.isArray(pref?.eventReminderKinds)
			? pref.eventReminderKinds
			: ['appointment', 'reminder', 'deadline', 'inferred_event'],
		prefetchedTemporalEvents: temporalEventsResult.items,
		prefetchedNextCursor: temporalEventsResult.nextCursor
	};
};
