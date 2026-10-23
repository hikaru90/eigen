import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

/**
 * /memory left the chrome with the ei redesign (docs/planning/ei-redesign.md,
 * decision 1): Yarn / Threads / Patterns under /mesh replace the old Memory hub,
 * and the raw graph / embeddings views that lived here have no nav home for now.
 *
 * A `?thought=` deep link (what the /graph legacy redirect forwards) still has
 * a home — the thought page — so it is handed on rather than dropped. Every
 * other query param described a retired view and is let go.
 */
function meshPath(url: URL): string {
  const thought = url.searchParams.get('thought')
  if (thought) return `/thought/${encodeURIComponent(thought)}`
  return '/mesh'
}

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  throw redirect(302, meshPath(event.url))
}
