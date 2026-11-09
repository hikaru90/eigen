import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { loadNowHistory, NowHistoryCursorError } from '$lib/server/mesh/now-history'

/** Answered Now cards, newest first, 50 per page; no LLM call (docs/planning/feature-mesh-now.md, section 5). */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })
  const before = url.searchParams.get('before')
  try {
    return json(await loadNowHistory(locals.user.id, before === null ? {} : { before }))
  } catch (err) {
    if (err instanceof NowHistoryCursorError) return json({ error: err.message }, { status: 400 })
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
