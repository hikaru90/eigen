import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/brain.schema'
import {
  factIdsDerivedFromThought,
  retireFactsWithoutLiveSource,
} from '$lib/server/facts/user-fact-lifecycle'
import { deleteThoughtVertexFromGraph } from '$lib/server/graph/age'
import { withEvalDb } from './eval-context'

/** Delete a corpus thought (AGE vertex + Postgres row + the facts only it carried). Safe when already absent. */
export async function deleteCorpusThought(input: {
  evalUserId: string
  thoughtId: string
}): Promise<boolean> {
  return withEvalDb(input.evalUserId, async () => {
    const db = getDb()
    const [row] = await db
      .select({ id: thought.id })
      .from(thought)
      .where(and(eq(thought.userId, input.evalUserId), eq(thought.id, input.thoughtId)))
      .limit(1)
    if (!row) return false

    // the fact links cascade away with the row: read what this thought carried first
    const carriedFactIds = await factIdsDerivedFromThought(input.evalUserId, input.thoughtId)
    await deleteThoughtVertexFromGraph({ userId: input.evalUserId, thoughtId: input.thoughtId })
    await db
      .delete(thought)
      .where(and(eq(thought.userId, input.evalUserId), eq(thought.id, input.thoughtId)))
    await retireFactsWithoutLiveSource(input.evalUserId, carriedFactIds, { revive: true })
    return true
  })
}
