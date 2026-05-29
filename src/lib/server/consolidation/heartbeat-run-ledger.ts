/**
 * Per-user heartbeat run history and live progress (RLS-scoped).
 */

import { and, desc, eq } from 'drizzle-orm';
import { getDb, withDbUser } from '$lib/server/db';
import { heartbeatRun, type HeartbeatRunStatus } from '$lib/server/db/schema';
import {
	formatConsolidationJobErrors,
	type ConsolidationJobResult,
	type ConsolidationRunResult
} from './runner';
import type { CommunitySummaryStats } from './community-summaries';

export type HeartbeatRunSnapshot = {
	runId: string;
	startedAt: Date;
	status: HeartbeatRunStatus;
	plannedJobs: string[];
	currentJob: string | null;
	cancelRequested: boolean;
	jobs: ConsolidationJobResult[];
	totalDurationMs: number;
	error: string | null;
};

function rowToSnapshot(row: {
	id: string;
	startedAt: Date;
	status: HeartbeatRunStatus;
	plannedJobs: string[] | null;
	currentJob: string | null;
	cancelRequested: boolean;
	jobs: Record<string, unknown>[] | null;
	totalDurationMs: number;
	errorMessage: string | null;
}): HeartbeatRunSnapshot {
	const jobs = (row.jobs ?? []) as ConsolidationJobResult[];
	const jobErrors = formatConsolidationJobErrors(jobs);
	return {
		runId: row.id,
		startedAt: row.startedAt,
		status: row.status,
		plannedJobs: row.plannedJobs ?? [],
		currentJob: row.currentJob,
		cancelRequested: row.cancelRequested,
		jobs,
		totalDurationMs: row.totalDurationMs,
		error:
			jobErrors.length > 0
				? jobErrors.join('; ')
				: row.errorMessage
	};
}

/** Requires an active {@link withDbUser} / request DB context. */
export async function insertRunningHeartbeatRun(
	userId: string,
	plannedJobs: string[]
): Promise<string> {
	const db = getDb();
	const [row] = await db
		.insert(heartbeatRun)
		.values({
			userId,
			status: 'running',
			plannedJobs,
			jobs: [],
			totalDurationMs: 0
		})
		.returning({ id: heartbeatRun.id });
	if (!row) {
		throw new Error('Failed to create heartbeat run row');
	}
	return row.id;
}

/** Requires an active {@link withDbUser} / request DB context. */
export async function patchHeartbeatRunProgress(
	userId: string,
	runId: string,
	patch: {
		currentJob?: string | null;
		jobs?: ConsolidationJobResult[];
		cancelRequested?: boolean;
	}
): Promise<void> {
	const db = getDb();
	await db
		.update(heartbeatRun)
		.set({
			...(patch.currentJob !== undefined ? { currentJob: patch.currentJob } : {}),
			...(patch.jobs !== undefined ? { jobs: patch.jobs as ConsolidationJobResult[] } : {}),
			...(patch.cancelRequested !== undefined ? { cancelRequested: patch.cancelRequested } : {})
		})
		.where(and(eq(heartbeatRun.id, runId), eq(heartbeatRun.userId, userId)));
}

/** Requires an active {@link withDbUser} / request DB context. */
export async function readHeartbeatRunCancelRequested(
	userId: string,
	runId: string
): Promise<boolean> {
	const db = getDb();
	const [row] = await db
		.select({ cancelRequested: heartbeatRun.cancelRequested })
		.from(heartbeatRun)
		.where(and(eq(heartbeatRun.id, runId), eq(heartbeatRun.userId, userId)))
		.limit(1);
	return row?.cancelRequested ?? false;
}

export async function createRunningHeartbeatRun(
	userId: string,
	plannedJobs: string[]
): Promise<string> {
	return withDbUser(userId, () => insertRunningHeartbeatRun(userId, plannedJobs));
}

export async function updateHeartbeatRunProgress(
	userId: string,
	runId: string,
	patch: {
		currentJob?: string | null;
		jobs?: ConsolidationJobResult[];
		cancelRequested?: boolean;
	}
): Promise<void> {
	return withDbUser(userId, () => patchHeartbeatRunProgress(userId, runId, patch));
}

export async function finishHeartbeatRun(
	userId: string,
	runId: string,
	result: ConsolidationRunResult,
	status: Extract<HeartbeatRunStatus, 'completed' | 'failed' | 'cancelled'>,
	errorMessage?: string | null
): Promise<void> {
	const errors = formatConsolidationJobErrors(result.jobs);
	await withDbUser(userId, async () => {
		const db = getDb();
		await db
			.update(heartbeatRun)
			.set({
				status,
				currentJob: null,
				jobs: result.jobs as ConsolidationJobResult[],
				totalDurationMs: result.totalDurationMs,
				errorMessage: errorMessage ?? (errors.length > 0 ? errors.join('; ') : null),
				finishedAt: new Date()
			})
			.where(and(eq(heartbeatRun.id, runId), eq(heartbeatRun.userId, userId)));
	});
}

export async function requestHeartbeatRunCancel(userId: string, runId: string): Promise<boolean> {
	return withDbUser(userId, async () => {
		const db = getDb();
		const rows = await db
			.update(heartbeatRun)
			.set({ cancelRequested: true })
			.where(
				and(
					eq(heartbeatRun.id, runId),
					eq(heartbeatRun.userId, userId),
					eq(heartbeatRun.status, 'running')
				)
			)
			.returning({ id: heartbeatRun.id });
		return rows.length > 0;
	});
}

export async function isHeartbeatRunCancelRequested(
	userId: string,
	runId: string
): Promise<boolean> {
	return withDbUser(userId, () => readHeartbeatRunCancelRequested(userId, runId));
}

export async function loadActiveHeartbeatRun(
	userId: string
): Promise<HeartbeatRunSnapshot | null> {
	return withDbUser(userId, async () => {
		const db = getDb();
		const [row] = await db
			.select({
				id: heartbeatRun.id,
				startedAt: heartbeatRun.startedAt,
				status: heartbeatRun.status,
				plannedJobs: heartbeatRun.plannedJobs,
				currentJob: heartbeatRun.currentJob,
				cancelRequested: heartbeatRun.cancelRequested,
				jobs: heartbeatRun.jobs,
				totalDurationMs: heartbeatRun.totalDurationMs,
				errorMessage: heartbeatRun.errorMessage
			})
			.from(heartbeatRun)
			.where(and(eq(heartbeatRun.userId, userId), eq(heartbeatRun.status, 'running')))
			.orderBy(desc(heartbeatRun.startedAt))
			.limit(1);
		if (!row) return null;
		return rowToSnapshot({ ...row, status: row.status as HeartbeatRunStatus });
	});
}

export async function loadLastUserHeartbeatRun(userId: string): Promise<HeartbeatRunSnapshot | null> {
	return withDbUser(userId, async () => {
		const db = getDb();
		const [row] = await db
			.select({
				id: heartbeatRun.id,
				startedAt: heartbeatRun.startedAt,
				status: heartbeatRun.status,
				plannedJobs: heartbeatRun.plannedJobs,
				currentJob: heartbeatRun.currentJob,
				cancelRequested: heartbeatRun.cancelRequested,
				jobs: heartbeatRun.jobs,
				totalDurationMs: heartbeatRun.totalDurationMs,
				errorMessage: heartbeatRun.errorMessage
			})
			.from(heartbeatRun)
			.where(eq(heartbeatRun.userId, userId))
			.orderBy(desc(heartbeatRun.startedAt))
			.limit(1);
		if (!row) return null;
		return rowToSnapshot({ ...row, status: row.status as HeartbeatRunStatus });
	});
}

/** Mark stale running rows failed when the in-process worker is gone (dev reload, crash). */
export async function recoverOrphanedHeartbeatRun(userId: string): Promise<boolean> {
	return withDbUser(userId, async () => {
		const db = getDb();
		const rows = await db
			.update(heartbeatRun)
			.set({
				status: 'failed' satisfies HeartbeatRunStatus,
				currentJob: null,
				errorMessage: 'Heartbeat stopped unexpectedly (server reload or crash).',
				finishedAt: new Date()
			})
			.where(and(eq(heartbeatRun.userId, userId), eq(heartbeatRun.status, 'running')))
			.returning({ id: heartbeatRun.id });
		return rows.length > 0;
	});
}

export async function loadHeartbeatRunById(
	userId: string,
	runId: string
): Promise<HeartbeatRunSnapshot | null> {
	return withDbUser(userId, async () => {
		const db = getDb();
		const [row] = await db
			.select({
				id: heartbeatRun.id,
				startedAt: heartbeatRun.startedAt,
				status: heartbeatRun.status,
				plannedJobs: heartbeatRun.plannedJobs,
				currentJob: heartbeatRun.currentJob,
				cancelRequested: heartbeatRun.cancelRequested,
				jobs: heartbeatRun.jobs,
				totalDurationMs: heartbeatRun.totalDurationMs,
				errorMessage: heartbeatRun.errorMessage
			})
			.from(heartbeatRun)
			.where(and(eq(heartbeatRun.id, runId), eq(heartbeatRun.userId, userId)))
			.limit(1);
		if (!row) return null;
		return rowToSnapshot({ ...row, status: row.status as HeartbeatRunStatus });
	});
}

export function heartbeatProgressPct(
	snapshot: HeartbeatRunSnapshot,
	summaryStats?: CommunitySummaryStats | null
): number {
	const planned = snapshot.plannedJobs.length;
	if (planned === 0) return snapshot.status === 'running' ? 0 : 100;
	const completed = snapshot.jobs.length;
	const inFlight = snapshot.currentJob ? 0.5 : 0;
	let pct = ((completed + inFlight) / planned) * 100;

	if (
		snapshot.currentJob === 'community_summaries' &&
		summaryStats &&
		summaryStats.total > 0
	) {
		const summariesJobIndex = snapshot.plannedJobs.indexOf('community_summaries');
		const priorJobs = summariesJobIndex >= 0 ? summariesJobIndex : completed;
		const summariesFraction = summaryStats.summarized / summaryStats.total;
		pct = ((priorJobs + summariesFraction) / planned) * 100;
	}

	return Math.min(100, Math.round(pct));
}

export function isHeartbeatRunActive(status: HeartbeatRunStatus): boolean {
	return status === 'running';
}
