import { randomUUID } from 'node:crypto'
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants'
import { setUserScheduledTaskPaused } from '$lib/server/scheduled-tasks/service'
import { loadActiveHeartbeatRun } from '$lib/server/consolidation/heartbeat-run-ledger'
import { getHeartbeatJobPlan } from '$lib/consolidation/heartbeat-job-plan'
import {
  OVERNIGHT_CONSOLIDATION_JOB,
  drainUserJobQueue,
  enqueueUserJob,
  hasActiveJobForUser,
} from '$lib/server/job-queue'
import {
  recoverOrphanedOvernightState,
  stopOvernightHeartbeat,
} from '$lib/server/job-queue/recover-overnight'

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) {
    error(401, 'Unauthorized')
  }

  const taskId = params.taskId
  if (!taskId) {
    error(400, 'taskId is required')
  }

  let body: { paused?: boolean }
  try {
    body = await request.json()
  } catch {
    error(400, 'Invalid JSON body')
  }

  if (typeof body.paused !== 'boolean') {
    error(400, 'Body must include paused: boolean')
  }

  try {
    await setUserScheduledTaskPaused(locals.user.id, taskId, body.paused)
    return json({ ok: true, paused: body.paused })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[scheduled-tasks] pause toggle failed', { taskId, message })
    return json({ ok: false, error: message }, { status: 500 })
  }
}

export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) {
    error(401, 'Unauthorized')
  }

  const taskId = params.taskId
  if (!taskId) {
    error(400, 'taskId is required')
  }

  if (taskId !== SLEEP_CONSOLIDATION_TASK_ID) {
    error(404, 'Unknown scheduled task')
  }

  try {
    const userId = locals.user.id

    // Clear stale orphans from a prior crash/reload before checking active work.
    await recoverOrphanedOvernightState(userId).catch(() => {})

    if (await hasActiveJobForUser(userId, OVERNIGHT_CONSOLIDATION_JOB)) {
      const active = await loadActiveHeartbeatRun(userId).catch(() => null)
      return json(
        {
          ok: false,
          error: 'A heartbeat is already running.',
          runId: active?.runId,
          status: 'running',
        },
        { status: 409 },
      )
    }

    const outcome = await enqueueUserJob({
      userId,
      jobType: OVERNIGHT_CONSOLIDATION_JOB,
      runAfter: new Date(),
      dedupeKey: `manual:${randomUUID()}`,
      payload: { manual: true },
    })

    if (!outcome.enqueued) {
      return json({ ok: false, error: 'A heartbeat is already queued.' }, { status: 409 })
    }

    const plannedJobs = getHeartbeatJobPlan()

    // Drain in the background so the client can show Stop and poll progress.
    void drainUserJobQueue({ userId, limit: 1 }).catch((err) => {
      console.error('[scheduled-tasks] background drain failed', {
        userId,
        jobId: outcome.jobId,
        message: err instanceof Error ? err.message : String(err),
      })
    })

    return json(
      {
        ok: true,
        jobId: outcome.jobId,
        plannedJobs,
        status: 'queued',
        message: 'Heartbeat started.',
      },
      { status: 202 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[scheduled-tasks] run now failed', { taskId, message })
    return json({ ok: false, error: message }, { status: 500 })
  }
}

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) {
    error(401, 'Unauthorized')
  }

  const taskId = params.taskId
  if (!taskId) {
    error(400, 'taskId is required')
  }

  if (taskId !== SLEEP_CONSOLIDATION_TASK_ID) {
    error(404, 'Unknown scheduled task')
  }

  const userId = locals.user.id
  const result = await stopOvernightHeartbeat(userId)
  return json({
    ok: true,
    softCancelled: result.softCancelled,
    clearedStuck: result.clearedStuck,
    message: result.message,
  })
}
