/**
 * Removes low-support ENTITY_RELATES edges that lack same-thought co-mention evidence.
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { entityResolutionLog } from '$lib/server/db/schema'
import { deleteEntityRelationEdge, fetchEntityEdgesForUser } from '$lib/server/graph/age'

export type PruneSuspiciousEntityEdgesResult = {
  scanned: number
  removed: number
}

function undirectedPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

async function loadCoMentionPairKeys(userId: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({
      thoughtId: entityResolutionLog.thoughtId,
      entityId: entityResolutionLog.canonicalEntityId,
    })
    .from(entityResolutionLog)
    .where(
      and(eq(entityResolutionLog.userId, userId), isNotNull(entityResolutionLog.canonicalEntityId)),
    )

  const byThought = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.entityId) continue
    let bucket = byThought.get(row.thoughtId)
    if (!bucket) {
      bucket = new Set()
      byThought.set(row.thoughtId, bucket)
    }
    bucket.add(row.entityId)
  }

  const pairs = new Set<string>()
  for (const entityIds of byThought.values()) {
    const ids = [...entityIds]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        pairs.add(undirectedPairKey(ids[i], ids[j]))
      }
    }
  }
  return pairs
}

export async function pruneSuspiciousEntityEdgesForUser(
  userId: string,
): Promise<PruneSuspiciousEntityEdgesResult> {
  const edges = await fetchEntityEdgesForUser({ userId })
  const coMentionPairs = await loadCoMentionPairKeys(userId)
  let removed = 0

  for (const edge of edges) {
    if (edge.predicate !== 'related_to') continue
    const pairKey = undirectedPairKey(edge.sourceId, edge.targetId)
    if (coMentionPairs.has(pairKey)) continue
    if (edge.weight > 1) continue

    await deleteEntityRelationEdge({
      userId,
      sourceEntityId: edge.sourceId,
      targetEntityId: edge.targetId,
      predicate: edge.predicate,
    })
    removed++
  }

  return { scanned: edges.length, removed }
}
