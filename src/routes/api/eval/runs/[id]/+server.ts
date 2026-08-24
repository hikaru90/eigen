import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { dev } from '$app/environment'
import { getActiveEvalRunId, recoverOrphanedEvalRun } from '$lib/eval/runner'
import { loadEvalRunDetail } from '$lib/eval/store'

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!dev) return json({ error: 'Eval API only available in dev mode' }, { status: 403 })
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })

  await recoverOrphanedEvalRun(locals.user.id, params.id, getActiveEvalRunId())

  const detail = await loadEvalRunDetail(locals.user.id, params.id)
  if (!detail) return json({ error: 'Run not found' }, { status: 404 })

  return json({
    ...detail,
    active: getActiveEvalRunId() === params.id,
  })
}
