import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { resolvePatternsOutcome } from '$lib/server/patterns/patterns-outcome'
import { getPatternsForUser } from '$lib/server/patterns/patterns-service'

export const load: PageServerLoad = (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  return {
    // Streamed on purpose: the page paints at once ("Reading your last three weeks…" + spinner)
    // and the judge's answer settles in when it lands — nothing waits on the LLM.
    // Always resolves to a typed outcome: a rejected stream reaches the client as an opaque error.
    patterns: resolvePatternsOutcome(getPatternsForUser(event.locals.user.id)),
  }
}
