import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'

const ACTIVE_ENRICH_STATUSES = ['pending', 'processing'] as const

/** Thought ids still waiting on tier-2 background enrich for this user. */
export async function listPendingEnrichThoughtIds(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        inArray(thought.enrichQueueStatus, [...ACTIVE_ENRICH_STATUSES]),
      ),
    )
  return rows.map((row) => row.id)
}
