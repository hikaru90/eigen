import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { listEvalRuns, loadEvalRunDetail } from '$lib/eval/store'
import { listEvalQa } from '$lib/eval/qa-store'
import { loadVersionEvalOverview } from '$lib/eval/version-overview'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const operatorUserId = event.locals.user.id
  const runs = await listEvalRuns(operatorUserId)
  const runIdParam = event.url.searchParams.get('run')?.trim() ?? null
  const selectedRunId =
    runIdParam && runs.some((r) => r.id === runIdParam) ? runIdParam : (runs[0]?.id ?? null)
  const detail = selectedRunId ? await loadEvalRunDetail(operatorUserId, selectedRunId) : null
  const qaItems = await listEvalQa()
  const versionOverview = await loadVersionEvalOverview(operatorUserId)

  return {
    user: event.locals.user,
    qaItems,
    versionOverview,
    runs,
    selectedRunId,
    run: detail?.run ?? null,
    entries: detail?.entries ?? [],
  }
}
