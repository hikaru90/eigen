import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/brain.schema'
import { deleteThoughtVertexFromGraph } from '$lib/server/graph/age'
import { withEvalDb } from './eval-context'

/** Delete a corpus thought (AGE vertex + Postgres row). Safe when already absent. */
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

    await deleteThoughtVertexFromGraph({ userId: input.evalUserId, thoughtId: input.thoughtId })
    await db
      .delete(thought)
      .where(and(eq(thought.userId, input.evalUserId), eq(thought.id, input.thoughtId)))
    return true
  })
}
