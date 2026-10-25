import type { AppDatabase } from '$lib/server/db'
import {
  activeThoughtCategoryKinds,
  ensureUserOntologySeeded,
  loadOntologyForUser,
} from '$lib/server/ontology-db'
import type { ThoughtKindOption } from '$lib/thought/kind-option'

/**
 * The type menu's options: the user's active thought_category kinds (the same catalog
 * every classifier uses — load-ontology.ts), with their one-line definitions.
 */
export async function loadThoughtKindOptions(
  db: AppDatabase,
  userId: string,
): Promise<ThoughtKindOption[]> {
  await ensureUserOntologySeeded(db, userId)
  const ontology = await loadOntologyForUser(db, userId)
  return activeThoughtCategoryKinds(ontology).map((kind) => ({
    key: kind.key,
    name: kind.name,
    definition: kind.definition,
  }))
}
