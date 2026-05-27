/**
 * User-facing scheduled task registry and pg_cron control.
 */

import { desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { consolidationRun } from '$lib/server/db/schema';
import {
	formatConsolidationJobErrors,
	type ConsolidationRunResult
} from '$lib/server/consolidation/runner';
import {
	SLEEP_CONSOLIDATION_JOB_NAME,
	SLEEP_CONSOLIDATION_TASK_ID
} from './constants';

export type ScheduledTaskStatus = {
	id: string;
	title: string;
	description: string;
	scheduleLabel: string;
	active: boolean;
	/** False when pg_cron job row is missing (not bootstrapped or extension unavailable). */
	configured: boolean;
	lastRunAt: string | null;
	lastRunStatus: 'completed' | 'failed' | 'running' | null;
	/** User-visible error from the last run, when relevant to this user. */
	lastRunError: string | null;
};

type PgCronJobRow = {
	jobid: number;
	jobname: string | null;
	schedule: string;
	active: boolean;
};

function getAdminDatabaseUrl(): string | null {
	const url = process.env.DATABASE_ADMIN_URL?.trim();
	return url || null;
}

function getCronTimezone(): string {
	return process.env.CONSOLIDATION_CRON_TZ?.trim() || 'UTC';
}

function getCronSchedule(): string {
	return process.env.CONSOLIDATION_CRON_SCHEDULE?.trim() || '0 2 * * *';
}

function formatScheduleLabel(schedule: string, timezone: string): string {
	if (schedule === '0 2 * * *') {
		return `Every day at 2:00 AM (${timezone})`;
	}
	return `Schedule: ${schedule} (${timezone})`;
}

function getAdminDb() {
	const url = getAdminDatabaseUrl();
	if (!url) {
		throw new Error('DATABASE_ADMIN_URL is not configured');
	}
	return postgres(url, { max: 2 });
}

async function queryPgCronJob(jobName: string): Promise<PgCronJobRow | null> {
	const sql = getAdminDb();
	try {
		const rows = await sql<PgCronJobRow[]>`
			SELECT jobid, jobname, schedule, active
			FROM cron.job
			WHERE jobname = ${jobName}
			LIMIT 1
		`;
		return rows[0] ?? null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (
			message.includes('cron.job') ||
			message.includes('pg_cron') ||
			message.includes('does not exist')
		) {
			return null;
		}
		throw err;
	} finally {
		await sql.end();
	}
}

async function setPgCronJobActive(jobName: string, active: boolean): Promise<void> {
	const sql = getAdminDb();
	try {
		const rows = await sql<{ jobid: number }[]>`
			SELECT jobid FROM cron.job WHERE jobname = ${jobName} LIMIT 1
		`;
		const job = rows[0];
		if (!job) {
			throw new Error('Heartbeat is not configured on this server');
		}
		await sql`SELECT cron.alter_job(${job.jobid}, ${null}, ${null}, ${null}, ${null}, ${active})`;
	} finally {
		await sql.end();
	}
}

function summarizeLastRunErrorForUser(
	userId: string,
	row: {
		status: 'completed' | 'failed' | 'running';
		errorMessage: string | null;
		jobs: Record<string, unknown> | null;
	}
): string | null {
	const results = row.jobs?.results as ConsolidationRunResult[] | undefined;
	const userResult = results?.find((r) => r.userId === userId);
	const jobErrors = userResult ? formatConsolidationJobErrors(userResult.jobs) : [];
	if (jobErrors.length > 0) {
		return jobErrors.join('; ');
	}
	if (row.status === 'failed' && row.errorMessage) {
		return row.errorMessage;
	}
	return null;
}

async function loadLastConsolidationRun(userId: string): Promise<{
	startedAt: Date;
	status: 'completed' | 'failed' | 'running';
	error: string | null;
} | null> {
	const url = getAdminDatabaseUrl();
	if (!url) return null;

	const sql = postgres(url, { max: 1 });
	try {
		const db = drizzle(sql, { schema: { consolidationRun } });
		const [row] = await db
			.select({
				startedAt: consolidationRun.startedAt,
				status: consolidationRun.status,
				errorMessage: consolidationRun.errorMessage,
				jobs: consolidationRun.jobs
			})
			.from(consolidationRun)
			.orderBy(desc(consolidationRun.startedAt))
			.limit(1);
		if (!row) return null;
		const status = row.status as 'completed' | 'failed' | 'running';
		return {
			startedAt: row.startedAt,
			status,
			error: summarizeLastRunErrorForUser(userId, {
				status,
				errorMessage: row.errorMessage,
				jobs: row.jobs
			})
		};
	} finally {
		await sql.end();
	}
}

export async function listScheduledTasks(userId: string): Promise<ScheduledTaskStatus[]> {
	const timezone = getCronTimezone();
	const defaultSchedule = getCronSchedule();
	const cronJob = await queryPgCronJob(SLEEP_CONSOLIDATION_JOB_NAME).catch(() => null);
	const lastRun = await loadLastConsolidationRun(userId).catch(() => null);

	const schedule = cronJob?.schedule ?? defaultSchedule;

	return [
		{
			id: SLEEP_CONSOLIDATION_TASK_ID,
			title: 'Overnight memory heartbeat',
			description:
				'Organizes your memory graph, refreshes summaries, and tidies unused labels while you sleep.',
			scheduleLabel: formatScheduleLabel(schedule, timezone),
			active: cronJob?.active ?? false,
			configured: cronJob !== null,
			lastRunAt: lastRun ? lastRun.startedAt.toISOString() : null,
			lastRunStatus: lastRun?.status ?? null,
			lastRunError: lastRun?.error ?? null
		}
	];
}

export async function setScheduledTaskPaused(taskId: string, paused: boolean): Promise<void> {
	if (taskId !== SLEEP_CONSOLIDATION_TASK_ID) {
		throw new Error(`Unknown scheduled task: ${taskId}`);
	}
	await setPgCronJobActive(SLEEP_CONSOLIDATION_JOB_NAME, !paused);
}
