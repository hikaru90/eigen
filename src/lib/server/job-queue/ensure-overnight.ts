import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { userScheduledTask } from '$lib/server/db/schema';
import {
	DEFAULT_OVERNIGHT_HOUR,
	DEFAULT_OVERNIGHT_MINUTE,
	DEFAULT_OVERNIGHT_TIMEZONE,
	OVERNIGHT_CONSOLIDATION_JOB
} from './constants';
import { enqueueUserJob, listProductionUserIds } from './enqueue';
import { calendarDateInTimezone, localScheduleToUtc } from './schedule-time';
import { createAdminSql } from './admin-db';
import { getOrCreateUserScheduledTask, markOvernightEnqueued } from './user-scheduled-task';

type ScheduleRow = {
	userId: string;
	runHour: number;
	runMinute: number;
	timezone: string;
	paused: boolean;
	lastEnqueuedNight: string | null;
};

async function loadScheduleRows(): Promise<ScheduleRow[]> {
	const sql = createAdminSql(1);
	try {
		const db = drizzle(sql, { schema: { userScheduledTask } });
		const configured = await db
			.select({
				userId: userScheduledTask.userId,
				runHour: userScheduledTask.runHour,
				runMinute: userScheduledTask.runMinute,
				timezone: userScheduledTask.timezone,
				paused: userScheduledTask.paused,
				lastEnqueuedNight: userScheduledTask.lastEnqueuedNight
			})
			.from(userScheduledTask)
			.where(eq(userScheduledTask.taskType, OVERNIGHT_CONSOLIDATION_JOB));

		const byUser = new Map(configured.map((row) => [row.userId, row]));
		const userIds = await listProductionUserIds();

		return userIds.map((userId) => {
			const row = byUser.get(userId);
			return {
				userId,
				runHour: row?.runHour ?? DEFAULT_OVERNIGHT_HOUR,
				runMinute: row?.runMinute ?? DEFAULT_OVERNIGHT_MINUTE,
				timezone: row?.timezone ?? DEFAULT_OVERNIGHT_TIMEZONE,
				paused: row?.paused ?? false,
				lastEnqueuedNight: row?.lastEnqueuedNight ?? null
			};
		});
	} finally {
		await sql.end();
	}
}

/**
 * Enqueue overnight consolidation jobs for users whose local schedule is due.
 */
export async function ensureOvernightJobsEnqueued(now = new Date()): Promise<number> {
	const schedules = await loadScheduleRows();
	let enqueued = 0;

	for (const schedule of schedules) {
		if (schedule.paused) continue;

		const tonight = calendarDateInTimezone(now, schedule.timezone);
		if (schedule.lastEnqueuedNight === tonight) continue;

		const runAt = localScheduleToUtc(
			tonight,
			schedule.runHour,
			schedule.runMinute,
			schedule.timezone
		);
		if (now < runAt) continue;

		const dedupeKey = `overnight:${tonight}`;
		const outcome = await enqueueUserJob({
			userId: schedule.userId,
			jobType: OVERNIGHT_CONSOLIDATION_JOB,
			runAfter: runAt,
			dedupeKey,
			payload: { scheduled: true, runNight: tonight }
		});

		if (outcome.enqueued) {
			await getOrCreateUserScheduledTask(schedule.userId, OVERNIGHT_CONSOLIDATION_JOB);
			await markOvernightEnqueued(schedule.userId, tonight);
			enqueued += 1;
			console.info('[job-queue] overnight enqueued', {
				userId: schedule.userId,
				runNight: tonight,
				jobId: outcome.jobId
			});
		}
	}

	return enqueued;
}
