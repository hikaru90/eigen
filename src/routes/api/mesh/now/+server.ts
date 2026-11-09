import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import {
  insufficientCreditsPayload,
  isInsufficientCreditsError,
} from '$lib/server/billing/insufficient-credits'
import { loadNowCard } from '$lib/server/mesh/now-store'

/** The Now card for Yarn (docs/planning/feature-mesh-now.md, section 5). */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return json(await loadNowCard(locals.user.id))
  } catch (err) {
    if (isInsufficientCreditsError(err)) {
      return json(insufficientCreditsPayload(err), { status: 402 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: message }, { status: 502 })
  }
}
