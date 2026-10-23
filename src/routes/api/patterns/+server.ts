import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { PatternsContractError } from '$lib/server/patterns/patterns-contract'
import { getPatternsForUser, type PatternsResult } from '$lib/server/patterns/patterns-service'

/**
 * GET /api/patterns — what the mesh notices about the last weeks (ei redesign
 * wave 2.4, additive). Auth and shape follow the neighbouring timeline
 * endpoints (src/routes/api/timeline/projects/+server.ts). Reads only; the
 * judge's result is cached in-process per user per day.
 */
export type PatternsApiResponse = PatternsResult

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  try {
    const result = await getPatternsForUser(user.id)
    return json(result satisfies PatternsApiResponse)
  } catch (err) {
    // The judge broke its JSON contract: say so, never serve fallback copy.
    if (err instanceof PatternsContractError) error(502, err.message)
    // Gateway / database failures surface as explicit 500s (fail loud).
    throw err
  }
}
