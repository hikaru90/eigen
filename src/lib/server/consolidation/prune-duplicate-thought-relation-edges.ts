/**
 * Removes weak related_to entity edges that are mostly supported by duplicate thought text.
 * This catches repeated-capture inflation (same sentence saved many times).
 */
import { sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { deleteEntityRelationEdge, fetchEntityEdgesForUser } from '$lib/server/graph/age'

const MIN_SUPPORTING_THOUGHTS = 3
const MIN_DUPLICATE_SHARE = 0.5

type PairSupportRow = {
  thought_count: number | string | null
  unique_text_count: number | string | null
}

export type PruneDuplicateThoughtRelationEdgesResult = {
  scanned: number
  flagged: number
  removed: number
}

function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v
  return Number(v ?? 0)
}

async function pairSupportStats(input: {
  userId: string
  sourceEntityId: string
  targetEntityId: string
}): Promise<{ thoughtCount: number; uniqueTextCount: number }> {
  const db = getDb()
  const result = await db.execute(sql`
		SELECT
			COUNT(DISTINCT e1.thought_id)::int AS thought_count,
			COUNT(DISTINCT t.normalized_text)::int AS unique_text_count
		FROM entity_resolution_log e1
		INNER JOIN entity_resolution_log e2
			ON e2.user_id = e1.user_id
			AND e2.thought_id = e1.thought_id
		INNER JOIN thought t
			ON t.id = e1.thought_id
			AND t.user_id = e1.user_id
		WHERE
			e1.user_id = ${input.userId}
			AND e1.canonical_entity_id = ${input.sourceEntityId}::uuid
			AND e2.canonical_entity_id = ${input.targetEntityId}::uuid
	`)
  const rows = Array.isArray(result)
    ? (result as unknown as PairSupportRow[])
    : ([...(result as unknown as Iterable<PairSupportRow>)])
  const row = rows[0]
  return {
    thoughtCount: num(row?.thought_count),
    uniqueTextCount: num(row?.unique_text_count),
  }
}

export async function pruneDuplicateThoughtRelationEdgesForUser(
  userId: string,
): Promise<PruneDuplicateThoughtRelationEdgesResult> {
  const edges = await fetchEntityEdgesForUser({ userId })
  let flagged = 0
  let removed = 0

  for (const edge of edges) {
    if (edge.predicate !== 'related_to') continue
    if (edge.weight > 1) continue

    const support = await pairSupportStats({
      userId,
      sourceEntityId: edge.sourceId,
      targetEntityId: edge.targetId,
    })
    if (support.thoughtCount < MIN_SUPPORTING_THOUGHTS) continue
    if (support.uniqueTextCount <= 0) continue
    const duplicateShare = (support.thoughtCount - support.uniqueTextCount) / support.thoughtCount
    if (duplicateShare < MIN_DUPLICATE_SHARE) continue

    flagged++
    await deleteEntityRelationEdge({
      userId,
      sourceEntityId: edge.sourceId,
      targetEntityId: edge.targetId,
      predicate: edge.predicate,
    })
    removed++
  }

  return { scanned: edges.length, flagged, removed }
}
