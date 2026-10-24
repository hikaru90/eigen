import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { upsertThoughtNode } from '$lib/server/graph/age'
import { graphAuthorProperty } from '$lib/server/memory/authorship'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'

export type SetThoughtCategoryResult =
  | { ok: true; category: string }
  | { ok: false; reason: 'not_found' | 'unknown_category' }

/**
 * The user picked a type for a thought (the type menu on the thought page): store
 * exactly that — the key must exist in their ontology — and mirror it onto the
 * graph's Thought node. No LLM: the decision is the user's. (A natural-language
 * edit re-classifies from the words, so "keep it as a task" could never change it.)
 */
export async function setThoughtCategory(
  userId: string,
  thoughtId: string,
  categoryKey: string,
): Promise<SetThoughtCategoryResult> {
  const db = getDb()
  const [row] = await db
    .select({
      lifecycleStatus: thought.lifecycleStatus,
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) return { ok: false, reason: 'not_found' }

  await ensureUserOntologySeeded(db, userId)
  const kind = (await loadOntologyForUser(db, userId)).entityKindsByKey.get(categoryKey)
  if (!kind) return { ok: false, reason: 'unknown_category' }

  await db
    .update(thought)
    .set({ category: categoryKey, ontologyEntityKindId: kind.id, updatedAt: new Date() })
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))

  // archived thoughts are not in the graph; everything else carries its category there
  if (row.lifecycleStatus !== 'archived') {
    await upsertThoughtNode({
      id: thoughtId,
      userId,
      category: categoryKey,
      author: graphAuthorProperty({
        author: row.author,
        authorLabel: row.authorLabel,
        authorKeyId: row.authorKeyId,
      }),
    })
  }
  return { ok: true, category: categoryKey }
}
