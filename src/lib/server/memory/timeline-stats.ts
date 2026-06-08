import { and, eq, gte, lt, lte } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { temporalEvent } from '$lib/server/db/schema';
import {
	listTemporalEventsForUser,
	type TemporalEventListItem
} from '$lib/server/memory/temporal-event-list';
import { overdueDebtMinutes } from '$lib/graph/timeline-overdue';
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone';
import { isOpenTodoToday } from '$lib/server/memory/timeline-today-server';

export type TimelineStats = {
	completionsThisWeek: number;
	streakDays: number;
	overdueDebtMinutes: number;
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

function startOfLocalDay(date: Date, timeZone: string): Date {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(date);
	const year = Number(parts.find((p) => p.type === 'year')?.value);
	const month = Number(parts.find((p) => p.type === 'month')?.value);
	const day = Number(parts.find((p) => p.type === 'day')?.value);
	return new Date(Date.UTC(year, month - 1, day));
}

export async function computeTimelineStatsForUser(userId: string): Promise<TimelineStats> {
	const now = new Date();
	const timeZone = await getUserPreferredTimezone(userId);
	const weekStart = startOfWeek(now);
	const todayStart = startOfLocalDay(now, timeZone);
	const todayEnd = new Date(todayStart);
	todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

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

	const doneTodayRows = await getDb()
		.select({ id: temporalEvent.id })
		.from(temporalEvent)
		.where(
			and(
				eq(temporalEvent.userId, userId),
				eq(temporalEvent.lifecycleStatus, 'completed'),
				gte(temporalEvent.lifecycleUpdatedAt, todayStart),
				lt(temporalEvent.lifecycleUpdatedAt, todayEnd)
			)
		);

	const todoToday = openItems.filter((item) => isOpenTodoToday(item, now, timeZone));

	return {
		completionsThisWeek: completionsThisWeek.length,
		streakDays,
		overdueDebtMinutes: overdueDebtMinutes(openItems, now),
		todoTodayCount: todoToday.length,
		doneTodayCount: doneTodayRows.length,
		estimatedMinutesToday: todoToday.reduce((sum, item) => sum + (item.durationMinutes ?? 30), 0)
	};
}
