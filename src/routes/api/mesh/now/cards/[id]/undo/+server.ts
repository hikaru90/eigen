import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { NowAnswerError, undoNowCard } from '$lib/server/mesh/now-answer'

/** Undo the latest Now answer within 6 seconds (docs/planning/feature-mesh-now.md, section 5). */
export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return json(await undoNowCard({ userId: locals.user.id, cardId: params.id }))
  } catch (err) {
    if (err instanceof NowAnswerError) return json({ error: err.message }, { status: err.status })
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
