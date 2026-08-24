import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { getActiveEvalRunId, stopActiveEvalRun } from '$lib/eval/runner'
import { appendEvalEvent, loadEvalRunDetail, updateEvalRunStatus } from '$lib/eval/store'

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!dev) return json({ error: 'Eval API only available in dev mode' }, { status: 403 })
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })

  const runId = params.id
  const detail = await loadEvalRunDetail(locals.user.id, runId)
  if (!detail) return json({ error: 'Run not found' }, { status: 404 })

  if (detail.run.status !== 'running') {
    return json({ error: 'Run is not in progress', status: detail.run.status }, { status: 409 })
  }

  const stopped = stopActiveEvalRun(runId)
  if (!stopped) {
    return json(
      {
        error:
          'Run is not active in this server process (dev reload?). Refresh the page or start a new run.',
      },
      { status: 409 },
    )
  }

  await updateEvalRunStatus(locals.user.id, runId, {
    status: 'stopped',
    error: 'Stopped by operator',
  })
  await appendEvalEvent({
    operatorUserId: locals.user.id,
    runId,
    level: 'warn',
    message: 'Stop requested from /eval UI',
  })

  return json({ success: true, runId, active: getActiveEvalRunId() === runId })
}
