import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import type { MemoryAuthor } from '$lib/server/db/schema'
import { thought } from '$lib/server/db/schema'
import { activeThoughtLifecycleCondition } from '$lib/server/memory/thought-lifecycle-filter'

export const THOUGHT_ANN_LIMIT = 30

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/** Nearest active thoughts to a query embedding (pgvector cosine distance), closest first. */
export function fetchThoughtAnn(params: {
  userId: string
  queryEmbedding: number[]
  authorFilter?: MemoryAuthor
}) {
  const vectorDistance = sql<number>`${thought.embedding} <=> ${toVectorLiteral(params.queryEmbedding)}::vector`
  return getDb()
    .select({ id: thought.id, distance: vectorDistance })
    .from(thought)
    .where(
      and(
        eq(thought.userId, params.userId),
        activeThoughtLifecycleCondition(),
        isNotNull(thought.embedding),
        params.authorFilter ? eq(thought.author, params.authorFilter) : undefined,
      ),
    )
    .orderBy(vectorDistance)
    .limit(THOUGHT_ANN_LIMIT)
}
