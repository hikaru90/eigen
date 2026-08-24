import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants'
import {
  HeartbeatJobRetryError,
  retryFailedHeartbeatJob,
} from '$lib/server/scheduled-tasks/service'

export const POST: RequestHandler = async ({ locals, params, request }) => {
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

  let body: { runId?: unknown; jobId?: unknown }
  try {
    body = await request.json()
  } catch {
    error(400, 'Invalid JSON body')
  }

  const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
  const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : ''
  if (!runId || !jobId) {
    error(400, 'Body must include runId and jobId')
  }

  try {
    const result = await retryFailedHeartbeatJob(locals.user.id, { runId, jobId })
    return json({
      ok: true,
      runId: result.run.runId,
      status: result.run.status,
      job: result.job,
      message: result.job.ok ? `Retried ${jobId} successfully.` : `Retry of ${jobId} failed again.`,
    })
  } catch (err) {
    if (err instanceof HeartbeatJobRetryError) {
      return json({ ok: false, error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[scheduled-tasks] retry job failed', { taskId, jobId, message })
    return json({ ok: false, error: message }, { status: 500 })
  }
}
