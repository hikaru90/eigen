/**
 * In-process background worker for manual user heartbeat runs.
 */

import { withDbUser } from '$lib/server/db';
import {
	finishHeartbeatRun,
	insertRunningHeartbeatRun,
	loadActiveHeartbeatRun,
	patchHeartbeatRunProgress,
	readHeartbeatRunCancelRequested,
	recoverOrphanedHeartbeatRun,
	requestHeartbeatRunCancel
} from './heartbeat-run-ledger';
import { getHeartbeatJobPlan } from '$lib/consolidation/heartbeat-job-plan';
import { consolidateForUser, type ConsolidationJobResult } from './runner';

const activeUserRuns = new Map<string, string>();

export function getInProcessHeartbeatRunId(userId: string): string | null {
	return activeUserRuns.get(userId) ?? null;
}

async function buildJobPlan(_userId: string): Promise<string[]> {
	return getHeartbeatJobPlan();
}

async function executeHeartbeatRun(userId: string, runId: string): Promise<void> {
	const completedJobs: ConsolidationJobResult[] = [];
	console.info('[heartbeat-worker] run started', { userId, runId });

	try {
		const result = await consolidateForUser(userId, {
			shouldCancel: () => readHeartbeatRunCancelRequested(userId, runId),
			onJobStart: async (job) => {
				console.info('[heartbeat-worker] job start', { userId, runId, job });
				await patchHeartbeatRunProgress(userId, runId, {
					currentJob: job,
					jobs: completedJobs
				});
			},
			onJobComplete: async (jobResult) => {
				completedJobs.push(jobResult);
				console.info('[heartbeat-worker] job complete', {
					userId,
					runId,
					job: jobResult.job,
					ok: jobResult.ok,
					detail: jobResult.detail,
					durationMs: jobResult.durationMs
				});
				await patchHeartbeatRunProgress(userId, runId, {
					currentJob: null,
					jobs: completedJobs
				});
			}
		});

		const cancelled = await withDbUser(userId, () =>
			readHeartbeatRunCancelRequested(userId, runId)
		).catch(() => false);
		const finalStatus = cancelled
			? 'cancelled'
			: result.jobs.some((j) => !j.ok)
				? 'failed'
				: 'completed';

		await finishHeartbeatRun(userId, runId, result, finalStatus);
		console.info('[heartbeat-worker] run finished', {
			userId,
			runId,
			status: finalStatus,
			totalDurationMs: result.totalDurationMs,
			jobs: result.jobs.map((j) => `${j.job}:${j.ok ? 'ok' : 'err'}`).join(',')
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[heartbeat-worker] run failed', {
			userId,
			runId,
			message,
			stack: err instanceof Error ? err.stack : undefined
		});
		await finishHeartbeatRun(
			userId,
			runId,
			{
				userId,
				jobs: completedJobs,
				totalDurationMs: completedJobs.reduce((sum, j) => sum + j.durationMs, 0)
			},
			'failed',
			message
		);
	} finally {
		activeUserRuns.delete(userId);
	}
}

export type StartHeartbeatResult =
	| { started: true; runId: string; plannedJobs: string[] }
	| { started: false; reason: 'already_running'; runId: string };

export async function startUserHeartbeat(userId: string): Promise<StartHeartbeatResult> {
	if (activeUserRuns.has(userId)) {
		return {
			started: false,
			reason: 'already_running',
			runId: activeUserRuns.get(userId)!
		};
	}

	activeUserRuns.set(userId, 'pending');
	try {
		const existing = await loadActiveHeartbeatRun(userId);
		if (existing) {
			if (!getInProcessHeartbeatRunId(userId)) {
				await recoverOrphanedHeartbeatRun(userId);
			} else {
				activeUserRuns.delete(userId);
				return { started: false, reason: 'already_running', runId: existing.runId };
			}
		}

		const plannedJobs = await buildJobPlan(userId);
		const runId = await withDbUser(userId, () => insertRunningHeartbeatRun(userId, plannedJobs));
		activeUserRuns.set(userId, runId);
		console.info('[heartbeat-worker] queued', { userId, runId, plannedJobs });

		void executeHeartbeatRun(userId, runId).catch((err) => {
			console.error('[heartbeat-worker] unhandled run error', {
				userId,
				runId,
				message: err instanceof Error ? err.message : String(err)
			});
			activeUserRuns.delete(userId);
		});

		return { started: true, runId, plannedJobs };
	} catch (err) {
		activeUserRuns.delete(userId);
		throw err;
	}
}

export async function cancelUserHeartbeat(userId: string): Promise<boolean> {
	const runId = activeUserRuns.get(userId) ?? (await loadActiveHeartbeatRun(userId))?.runId;
	if (!runId) return false;
	console.info('[heartbeat-worker] cancel requested', { userId, runId });
	return requestHeartbeatRunCancel(userId, runId);
}
