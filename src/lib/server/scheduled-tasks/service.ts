/**
 * User-facing scheduled task registry backed by Postgres schedule + job queue.
 */

import { isHeartbeatJobId } from '$lib/consolidation/heartbeat-job-plan'
import {
  getCommunitySummaryStats,
  type CommunitySummaryStats,
} from '$lib/server/consolidation/community-summaries'
import {
  heartbeatProgressPct,
  isHeartbeatRunActive,
  loadActiveHeartbeatRun,
  loadHeartbeatRunById,
  loadLastUserHeartbeatRun,
  replaceFinishedHeartbeatJobResult,
  type HeartbeatRunSnapshot,
} from '$lib/server/consolidation/heartbeat-run-ledger'
import {
  formatConsolidationJobSummaries,
  runConsolidationJobForUser,
  type ConsolidationJobResult,
} from '$lib/server/consolidation/runner'
import {
  OVERNIGHT_CONSOLIDATION_JOB,
  formatScheduleLabel,
  getOrCreateUserScheduledTask,
  setUserScheduledTaskPaused as setQueueTaskPaused,
} from '$lib/server/job-queue'
import { hasActiveJobForUser } from '$lib/server/job-queue/enqueue'
import { recoverOrphanedOvernightState } from '$lib/server/job-queue/recover-overnight'
import { SLEEP_CONSOLIDATION_TASK_ID } from './constants'

export type ScheduledTaskStatus = {
  id: string
  title: string
  description: string
  scheduleLabel: string
  active: boolean
  /** True when the per-user schedule row exists (always after first load). */
  configured: boolean
  /** True when an overnight queue job is pending/running (blocks fresh Run now). */
  queueActive: boolean
  lastRunAt: string | null
  /** Stable id of the last finished (or active) heartbeat run — used for per-step retry. */
  lastRunId: string | null
  lastRunStatus: 'completed' | 'failed' | 'running' | 'cancelled' | null
  lastRunError: string | null
  lastRunSteps: string[] | null
  lastRunJobs: ConsolidationJobResult[] | null
  activeRun: {
    runId: string
    status: 'running'
    currentJob: string | null
    plannedJobs: string[]
    jobs: ConsolidationJobResult[]
    progressPct: number
    cancelRequested: boolean
    summaryStats: CommunitySummaryStats | null
  } | null
}

export class HeartbeatJobRetryError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'HeartbeatJobRetryError'
    this.status = status
  }
}

async function loadLastConsolidationRun(userId: string): Promise<{
  runId: string
  startedAt: Date
  status: 'completed' | 'failed' | 'running' | 'cancelled'
  error: string | null
  steps: string[] | null
  jobs: ConsolidationJobResult[] | null
  totalDurationMs: number | null
} | null> {
  const userRun = await loadLastUserHeartbeatRun(userId).catch(() => null)
  if (!userRun) return null

  const jobs = userRun.jobs
  return {
    runId: userRun.runId,
    startedAt: userRun.startedAt,
    status: userRun.status,
    error: userRun.error,
    steps: isHeartbeatRunActive(userRun.status) ? null : formatConsolidationJobSummaries(jobs),
    jobs: isHeartbeatRunActive(userRun.status) ? null : jobs,
    totalDurationMs: userRun.totalDurationMs,
  }
}

/**
 * Re-run one failed step from a finished heartbeat without repeating the full plan.
 */
export async function retryFailedHeartbeatJob(
  userId: string,
  input: { runId: string; jobId: string },
): Promise<{ run: HeartbeatRunSnapshot; job: ConsolidationJobResult }> {
  const jobId = input.jobId.trim()
  if (!isHeartbeatJobId(jobId)) {
    throw new HeartbeatJobRetryError(`Unknown heartbeat job: ${jobId}`, 400)
  }

  await recoverOrphanedOvernightState(userId).catch(() => {})

  if (await hasActiveJobForUser(userId, OVERNIGHT_CONSOLIDATION_JOB)) {
    throw new HeartbeatJobRetryError('A heartbeat is already running.', 409)
  }
  const active = await loadActiveHeartbeatRun(userId).catch(() => null)
  if (active) {
    throw new HeartbeatJobRetryError('A heartbeat is already running.', 409)
  }

  const run = await loadHeartbeatRunById(userId, input.runId)
  if (!run) {
    throw new HeartbeatJobRetryError('Heartbeat run not found.', 404)
  }
  if (isHeartbeatRunActive(run.status)) {
    throw new HeartbeatJobRetryError('Cannot retry a step while the heartbeat is running.', 409)
  }

  const existing = run.jobs.find((j) => j.job === jobId)
  if (!existing) {
    throw new HeartbeatJobRetryError(`Step ${jobId} was not part of this heartbeat run.`, 400)
  }
  if (existing.ok) {
    throw new HeartbeatJobRetryError('Only failed steps can be retried.', 400)
  }

  const job = await runConsolidationJobForUser(userId, jobId)
  const updated = await replaceFinishedHeartbeatJobResult(userId, input.runId, job)
  return { run: updated, job }
}

export async function listScheduledTasks(userId: string): Promise<ScheduledTaskStatus[]> {
  const schedule = await getOrCreateUserScheduledTask(userId, OVERNIGHT_CONSOLIDATION_JOB)

  await recoverOrphanedOvernightState(userId).catch(() => {})

  const activeRun = await loadActiveHeartbeatRun(userId).catch(() => null)
  const queueActive = await hasActiveJobForUser(userId, OVERNIGHT_CONSOLIDATION_JOB).catch(
    () => false,
  )

  const lastRun = await loadLastConsolidationRun(userId).catch(() => null)

  let summaryStats: CommunitySummaryStats | null = null
  if (activeRun?.currentJob === 'community_summaries') {
    summaryStats = await getCommunitySummaryStats(userId).catch(() => null)
  }

  return [
    {
      id: SLEEP_CONSOLIDATION_TASK_ID,
      title: 'Overnight memory heartbeat',
      description:
        'Organizes your memory graph, refreshes summaries, and tidies unused labels while you sleep.',
      scheduleLabel: formatScheduleLabel(schedule.runHour, schedule.runMinute, schedule.timezone),
      active: !schedule.paused,
      configured: true,
      queueActive,
      lastRunAt: activeRun
        ? activeRun.startedAt.toISOString()
        : lastRun
          ? lastRun.startedAt.toISOString()
          : null,
      lastRunId: activeRun?.runId ?? lastRun?.runId ?? null,
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
            summaryStats,
          }
        : null,
    },
  ]
}

export async function setUserScheduledTaskPaused(
  userId: string,
  taskId: string,
  paused: boolean,
): Promise<void> {
  if (taskId !== SLEEP_CONSOLIDATION_TASK_ID) {
    throw new Error(`Unknown scheduled task: ${taskId}`)
  }
  await setQueueTaskPaused(userId, OVERNIGHT_CONSOLIDATION_JOB, paused)
}
