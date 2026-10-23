import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { getPatternsForUser } from '$lib/server/patterns/patterns-service'

export const load: PageServerLoad = (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  return {
    // Streamed on purpose: the page paints at once ("Patterns, forming on their own")
    // and the judge's answer settles in when it lands — nothing waits on the LLM.
    patterns: getPatternsForUser(event.locals.user.id),
  }
}
