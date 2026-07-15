import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { userJobQueue } from '$lib/server/db/schema';
import {
	loadActiveHeartbeatRun,
	recoverOrphanedHeartbeatRun,
	requestHeartbeatRunCancel
} from '$lib/server/consolidation/heartbeat-run-ledger';
import {
	cancelUserHeartbeat,
	getInProcessHeartbeatRunId
} from '$lib/server/consolidation/heartbeat-worker';
import { OVERNIGHT_CONSOLIDATION_JOB } from './constants';
import { createAdminSql } from './admin-db';
import { isOvernightJobActiveInProcess } from './active-overnight-jobs';

const ORPHAN_JOB_MESSAGE = 'Interrupted before completion (server reload or crash).';
const STOPPED_JOB_MESSAGE = 'Stopped by user.';

export function findOrphanedOvernightJobIds(runningJobIds: string[]): string[] {
	return runningJobIds.filter((id) => !isOvernightJobActiveInProcess(id));
}

export function isManualOvernightJob(row: {
	dedupeKey: string | null;
	payload: Record<string, unknown> | null;
}): boolean {
	if (row.dedupeKey?.startsWith('manual:')) return true;
	return row.payload?.manual === true;
}

async function listRunningOvernightJobIds(userId: string): Promise<string[]> {
	const sqlClient = createAdminSql(1);
	try {
		const db = drizzle(sqlClient, { schema: { userJobQueue } });
		const rows = await db
			.select({ id: userJobQueue.id })
			.from(userJobQueue)
			.where(
				and(
					eq(userJobQueue.userId, userId),
					eq(userJobQueue.jobType, OVERNIGHT_CONSOLIDATION_JOB),
					eq(userJobQueue.status, 'running')
				)
			);
		return rows.map((row) => row.id);
	} finally {
		await sqlClient.end();
	}
}

async function finishOvernightJob(
	jobId: string,
	status: 'cancelled' | 'failed',
	lastError: string
): Promise<void> {
	const sqlClient = createAdminSql(1);
	try {
		const db = drizzle(sqlClient, { schema: { userJobQueue } });
		await db
			.update(userJobQueue)
			.set({
				status,
				lastError,
				finishedAt: new Date()
			})
			.where(eq(userJobQueue.id, jobId));
	} finally {
		await sqlClient.end();
	}
}

/**
 * Clear queue rows and heartbeat runs left "running" after a dev reload or crash.
 * Safe to call on every status poll — live jobs stay registered in {@link active-overnight-jobs}.
 */
export async function recoverOrphanedOvernightState(userId: string): Promise<void> {
	const runningJobIds = await listRunningOvernightJobIds(userId);
	const orphanedJobIds = findOrphanedOvernightJobIds(runningJobIds);

	for (const jobId of orphanedJobIds) {
		await finishOvernightJob(jobId, 'cancelled', ORPHAN_JOB_MESSAGE);
	}

	const inProcessWorkerRun = getInProcessHeartbeatRunId(userId);
	const activeRun = await loadActiveHeartbeatRun(userId).catch(() => null);
	if (!activeRun || inProcessWorkerRun) return;

	const stillRunningJobs = runningJobIds.length - orphanedJobIds.length;
	if (stillRunningJobs > 0) return;

	await recoverOrphanedHeartbeatRun(userId).catch(() => {});
}

/** Cancel stuck manual overnight queue rows (pending or orphaned running). */
export async function cancelStuckManualOvernightJobs(userId: string): Promise<number> {
	const sqlClient = createAdminSql(1);
	try {
		const db = drizzle(sqlClient, { schema: { userJobQueue } });
		const rows = await db
			.select({
				id: userJobQueue.id,
				status: userJobQueue.status,
				dedupeKey: userJobQueue.dedupeKey,
				payload: userJobQueue.payload
			})
			.from(userJobQueue)
			.where(
				and(
					eq(userJobQueue.userId, userId),
					eq(userJobQueue.jobType, OVERNIGHT_CONSOLIDATION_JOB),
					inArray(userJobQueue.status, ['pending', 'running'])
				)
			);

		let cancelled = 0;
		for (const row of rows) {
			if (!isManualOvernightJob(row)) continue;
			if (row.status === 'running' && isOvernightJobActiveInProcess(row.id)) {
				// Soft-cancel path owns the live worker; leave the queue row until drain finishes.
				continue;
			}
			await finishOvernightJob(row.id, 'cancelled', STOPPED_JOB_MESSAGE);
			cancelled += 1;
		}
		return cancelled;
	} finally {
		await sqlClient.end();
	}
}

export type StopOvernightHeartbeatResult = {
	/** Soft cancel was set on a live heartbeat_run. */
	softCancelled: boolean;
	/** Orphaned / stuck queue or run rows were cleared. */
	clearedStuck: boolean;
	message: string;
};

/**
 * Stop the current heartbeat: soft-cancel if live, otherwise clear stuck orphans
 * so a fresh Run now works. Does not delete completed job results already written.
 */
export async function stopOvernightHeartbeat(userId: string): Promise<StopOvernightHeartbeatResult> {
	const softCancelled = await cancelUserHeartbeat(userId).catch(() => false);

	await recoverOrphanedOvernightState(userId).catch(() => {});
	const cancelledManual = await cancelStuckManualOvernightJobs(userId).catch(() => 0);

	const stillActive = await loadActiveHeartbeatRun(userId).catch(() => null);
	const inProcess = getInProcessHeartbeatRunId(userId);
	if (stillActive && !inProcess) {
		const runningJobs = await listRunningOvernightJobIds(userId);
		const liveJobs = runningJobs.filter((id) => isOvernightJobActiveInProcess(id));
		if (liveJobs.length === 0) {
			// Soft-cancel first so recover marks the run cancelled (not failed).
			await requestHeartbeatRunCancel(userId, stillActive.runId).catch(() => false);
			await recoverOrphanedHeartbeatRun(userId).catch(() => {});
		}
	}

	const after = await loadActiveHeartbeatRun(userId).catch(() => null);
	const clearedStuck = cancelledManual > 0 || Boolean(stillActive && !after);

	if (softCancelled && after) {
		return {
			softCancelled: true,
			clearedStuck,
			message: 'Stop requested — finishing current step, then you can run again.'
		};
	}

	return {
		softCancelled: softCancelled && !after,
		clearedStuck: true,
		message: 'Heartbeat stopped. You can run again.'
	};
}
