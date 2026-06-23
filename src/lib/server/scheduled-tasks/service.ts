/**
 * User-facing scheduled task registry backed by Postgres schedule + job queue.
 */

import {
	formatConsolidationJobErrors,
	formatConsolidationJobSummaries,
	type ConsolidationJobResult
} from '$lib/server/consolidation/runner';
import {
	heartbeatProgressPct,
	isHeartbeatRunActive,
	loadActiveHeartbeatRun,
	loadLastUserHeartbeatRun,
	recoverOrphanedHeartbeatRun
} from '$lib/server/consolidation/heartbeat-run-ledger';
import {
	getCommunitySummaryStats,
	type CommunitySummaryStats
} from '$lib/server/consolidation/community-summaries';
import {
	SLEEP_CONSOLIDATION_TASK_ID
} from './constants';
import {
	OVERNIGHT_CONSOLIDATION_JOB,
	formatScheduleLabel,
	getOrCreateUserScheduledTask,
	setUserScheduledTaskPaused as setQueueTaskPaused
} from '$lib/server/job-queue';
import { hasActiveJobForUser } from '$lib/server/job-queue/enqueue';

export type ScheduledTaskStatus = {
	id: string;
	title: string;
	description: string;
	scheduleLabel: string;
	active: boolean;
	/** True when the per-user schedule row exists (always after first load). */
	configured: boolean;
	lastRunAt: string | null;
	lastRunStatus: 'completed' | 'failed' | 'running' | 'cancelled' | null;
	lastRunError: string | null;
	lastRunSteps: string[] | null;
	lastRunJobs: ConsolidationJobResult[] | null;
	activeRun: {
		runId: string;
		status: 'running';
		currentJob: string | null;
		plannedJobs: string[];
		jobs: ConsolidationJobResult[];
		progressPct: number;
		cancelRequested: boolean;
		summaryStats: CommunitySummaryStats | null;
	} | null;
};

async function loadLastConsolidationRun(userId: string): Promise<{
	startedAt: Date;
	status: 'completed' | 'failed' | 'running' | 'cancelled';
	error: string | null;
	steps: string[] | null;
	jobs: ConsolidationJobResult[] | null;
	totalDurationMs: number | null;
} | null> {
	const userRun = await loadLastUserHeartbeatRun(userId).catch(() => null);
	if (!userRun) return null;

	const jobs = userRun.jobs;
	return {
		startedAt: userRun.startedAt,
		status: userRun.status,
		error: userRun.error,
		steps: isHeartbeatRunActive(userRun.status)
			? null
			: formatConsolidationJobSummaries(jobs),
		jobs: isHeartbeatRunActive(userRun.status) ? null : jobs,
		totalDurationMs: userRun.totalDurationMs
	};
}

export async function listScheduledTasks(userId: string): Promise<ScheduledTaskStatus[]> {
	const schedule = await getOrCreateUserScheduledTask(userId, OVERNIGHT_CONSOLIDATION_JOB);

	let activeRun = await loadActiveHeartbeatRun(userId).catch(() => null);
	const queueRunning = await hasActiveJobForUser(userId, OVERNIGHT_CONSOLIDATION_JOB).catch(
		() => false
	);

	if (activeRun && !queueRunning) {
		await recoverOrphanedHeartbeatRun(userId).catch(() => {});
		activeRun = null;
	}

	const lastRun = await loadLastConsolidationRun(userId).catch(() => null);

	let summaryStats: CommunitySummaryStats | null = null;
	if (activeRun?.currentJob === 'community_summaries') {
		summaryStats = await getCommunitySummaryStats(userId).catch(() => null);
	}

	return [
		{
			id: SLEEP_CONSOLIDATION_TASK_ID,
			title: 'Overnight memory heartbeat',
			description:
				'Organizes your memory graph, refreshes summaries, and tidies unused labels while you sleep.',
			scheduleLabel: formatScheduleLabel(
				schedule.runHour,
				schedule.runMinute,
				schedule.timezone
			),
			active: !schedule.paused,
			configured: true,
			lastRunAt: activeRun
				? activeRun.startedAt.toISOString()
				: lastRun
					? lastRun.startedAt.toISOString()
					: null,
			lastRunStatus: activeRun ? 'running' : (lastRun?.status ?? null),
			lastRunError: activeRun ? null : (lastRun?.error ?? null),
			lastRunSteps: activeRun ? null : (lastRun?.steps ?? null),
			lastRunJobs: activeRun ? null : (lastRun?.jobs ?? null),
			activeRun: activeRun
				? {
						runId: activeRun.runId,
						status: 'running',
						currentJob: activeRun.currentJob,
						plannedJobs: activeRun.plannedJobs,
						jobs: activeRun.jobs,
						progressPct: heartbeatProgressPct(activeRun, summaryStats),
						cancelRequested: activeRun.cancelRequested,
						summaryStats
					}
				: null
		}
	];
}

export async function setUserScheduledTaskPaused(
	userId: string,
	taskId: string,
	paused: boolean
): Promise<void> {
	if (taskId !== SLEEP_CONSOLIDATION_TASK_ID) {
		throw new Error(`Unknown scheduled task: ${taskId}`);
	}
	await setQueueTaskPaused(userId, OVERNIGHT_CONSOLIDATION_JOB, paused);
}
