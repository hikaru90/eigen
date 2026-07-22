import { getHeartbeatJobPlan } from '$lib/consolidation/heartbeat-job-plan'
import { withDbUser } from '$lib/server/db'
import { consolidateForUser, type ConsolidationJobResult } from '$lib/server/consolidation/runner'
import {
  finishHeartbeatRun,
  insertRunningHeartbeatRun,
  patchHeartbeatRunProgress,
  readHeartbeatRunCancelRequested,
} from '$lib/server/consolidation/heartbeat-run-ledger'
import type { UserJobQueue } from '$lib/server/db/schema'

export async function processOvernightConsolidationJob(job: UserJobQueue): Promise<void> {
  const userId = job.userId
  const plannedJobs = getHeartbeatJobPlan()
  const completedJobs: ConsolidationJobResult[] = []

  const runId = await withDbUser(userId, () => insertRunningHeartbeatRun(userId, plannedJobs))

  try {
    const result = await consolidateForUser(userId, {
      shouldCancel: () => withDbUser(userId, () => readHeartbeatRunCancelRequested(userId, runId)),
      onJobStart: async (jobName) => {
        await withDbUser(userId, () =>
          patchHeartbeatRunProgress(userId, runId, {
            currentJob: jobName,
            jobs: completedJobs,
          }),
        )
      },
      onJobComplete: async (jobResult) => {
        completedJobs.push(jobResult)
        await withDbUser(userId, () =>
          patchHeartbeatRunProgress(userId, runId, {
            currentJob: null,
            jobs: completedJobs,
          }),
        )
      },
    })

    const cancelled = await withDbUser(userId, () =>
      readHeartbeatRunCancelRequested(userId, runId),
    ).catch(() => false)
    const finalStatus = cancelled
      ? 'cancelled'
      : result.jobs.some((j) => !j.ok)
        ? 'failed'
        : 'completed'

    await withDbUser(userId, () => finishHeartbeatRun(userId, runId, result, finalStatus))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await withDbUser(userId, () =>
      finishHeartbeatRun(
        userId,
        runId,
        {
          userId,
          jobs: completedJobs,
          totalDurationMs: 0,
        },
        'failed',
        message,
      ),
    ).catch(() => {})
    throw err
  }
}
