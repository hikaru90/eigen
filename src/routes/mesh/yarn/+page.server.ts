import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { getDb } from '$lib/server/db'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { loadYarnThoughts, type YarnThought } from '$lib/server/mesh/yarn-list'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { loadThoughtKindOptions } from '$lib/server/thought/kind-options'
import type { ThoughtKindOption } from '$lib/thought/kind-option'

/**
 * The Yarn journal's server load (ei redesign, wave 2.2). The query itself
 * lives in loadYarnThoughts (src/lib/server/mesh/yarn-list.ts), shared with
 * GET /api/mesh/yarn so the page can refetch when the global data view
 * changes. SSR seeds the default 'You' author scope (the selected view lives
 * in localStorage, invisible to the server) — the same contract the unified
 * timeline uses; the client refetches when the stored view differs.
 */

export type YarnPageData = {
  preferredTimezone: string
  /** Ontology kind names for chip labels, keyed by category. */
  kindLabels: Record<string, string>
  /** The type menu in an unfolded row: the active thought kinds. */
  kinds: ThoughtKindOption[]
  thoughts: YarnThought[]
}

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  const userId = event.locals.user.id
  const db = getDb()

  const preferredTimezone = await getUserPreferredTimezone(userId)

  // Ontology names for the kind chips (the memory hub loads it the same way).
  await ensureUserOntologySeeded(db, userId)
  const loadedOntology = await loadOntologyForUser(db, userId)
  const kindLabels: Record<string, string> = {}
  for (const kind of loadedOntology.entityKinds) {
    kindLabels[kind.key] = kind.name
  }

  const kinds = await loadThoughtKindOptions(db, userId)
  const thoughts = await loadYarnThoughts(userId, { author: 'user' })

  return {
    user: event.locals.user,
    preferredTimezone,
    kindLabels,
    kinds,
    thoughts,
  } satisfies YarnPageData & { user: NonNullable<App.Locals['user']> }
}
