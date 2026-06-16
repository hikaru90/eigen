import { and, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { temporalEvent } from '$lib/server/db/schema';
import { listTemporalEventsForUser } from '$lib/server/memory/temporal-event-list';
import { priorDayOverdueCount, overdueDebtMinutes } from '$lib/graph/timeline-overdue';
import { completedTodayCount } from '$lib/graph/timeline-completed-today';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';
import { isOpenTodoToday } from '$lib/server/memory/timeline-today-server';

export type TimelineStats = {
	completionsThisWeek: number;
	streakDays: number;
	overdueDebtMinutes: number;
	overdueCount: number;
	todoTodayCount: number;
	doneTodayCount: number;
	estimatedMinutesToday: number;
};

function startOfWeek(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay();
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

export async function computeTimelineStatsForUser(userId: string): Promise<TimelineStats> {
	const now = new Date();
	const timeZone = await getUserPreferredTimezone(userId);
	const weekStart = startOfWeek(now);

	const completionsThisWeek = await getDb()
		.select({ id: temporalEvent.id })
		.from(temporalEvent)
		.where(
			and(
				eq(temporalEvent.userId, userId),
				eq(temporalEvent.lifecycleStatus, 'completed'),
				gte(temporalEvent.lifecycleUpdatedAt, weekStart),
				lte(temporalEvent.lifecycleUpdatedAt, now)
			)
		);

	let streakDays = 0;
	for (let offset = 0; offset < 30; offset++) {
		const dayStart = new Date(now);
		dayStart.setDate(now.getDate() - offset);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = new Date(dayStart);
		dayEnd.setHours(23, 59, 59, 999);

		const rows = await getDb()
			.select({ id: temporalEvent.id })
			.from(temporalEvent)
			.where(
				and(
					eq(temporalEvent.userId, userId),
					eq(temporalEvent.lifecycleStatus, 'completed'),
					gte(temporalEvent.lifecycleUpdatedAt, dayStart),
					lte(temporalEvent.lifecycleUpdatedAt, dayEnd)
				)
			)
			.limit(1);

		if (rows.length === 0) break;
		streakDays += 1;
	}

	const { items: openItems } = await listTemporalEventsForUser({
		userId,
		status: 'open',
		range: 'all',
		includeOpenLoops: true
	});

	const { items: allItems } = await listTemporalEventsForUser({
		userId,
		status: 'all',
		range: 'all',
		includeOpenLoops: true
	});

	const todoToday = openItems.filter((item) => isOpenTodoToday(item, now, timeZone));

	return {
		completionsThisWeek: completionsThisWeek.length,
		streakDays,
		overdueDebtMinutes: overdueDebtMinutes(openItems, now),
		overdueCount: priorDayOverdueCount(openItems, timeZone, now),
		todoTodayCount: todoToday.length,
		doneTodayCount: completedTodayCount(allItems, timeZone, now),
		estimatedMinutesToday: todoToday.reduce((sum, item) => sum + (item.durationMinutes ?? 30), 0)
	};
}
