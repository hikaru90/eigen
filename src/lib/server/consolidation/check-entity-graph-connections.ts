/**
 * Validates entity relation edges against active ontology relation-kind endpoints.
 * Removes edges whose predicate/type pairing is not allowed.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity } from '$lib/server/db/schema'
import { deleteEntityRelationEdge, fetchEntityEdgesForUser } from '$lib/server/graph/age'
import { loadOntologyForUser } from '$lib/server/ontology-db/load-ontology'

export type CheckEntityGraphConnectionsResult = {
  scanned: number
  flagged: number
  removed: number
}

function relationTypePairKey(fromEntityType: string, toEntityType: string): string {
  return `${fromEntityType}->${toEntityType}`
}

export async function checkEntityGraphConnectionsForUser(
  userId: string,
): Promise<CheckEntityGraphConnectionsResult> {
  const edges = await fetchEntityEdgesForUser({ userId })
  if (edges.length === 0) {
    return { scanned: 0, flagged: 0, removed: 0 }
  }

  const db = getDb()
  const ontology = await loadOntologyForUser(db, userId)
  const allowedPredicatePairs = new Map<string, Set<string>>()

  for (const relationKind of ontology.relationKinds) {
    if (!relationKind.active) continue
    const fromKind = ontology.entityKindsById.get(relationKind.fromOntologyEntityKindId)
    const toKind = ontology.entityKindsById.get(relationKind.toOntologyEntityKindId)
    if (!fromKind || !toKind) continue
    if (fromKind.kindType !== 'entity_type' || toKind.kindType !== 'entity_type') continue

    let pairs = allowedPredicatePairs.get(relationKind.key)
    if (!pairs) {
      pairs = new Set<string>()
      allowedPredicatePairs.set(relationKind.key, pairs)
    }
    pairs.add(relationTypePairKey(fromKind.key, toKind.key))
  }

  const entityIds = [...new Set(edges.flatMap((edge) => [edge.sourceId, edge.targetId]))]
  const entities = await db
    .select({
      id: canonicalEntity.id,
      entityType: canonicalEntity.entityType,
    })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), inArray(canonicalEntity.id, entityIds)))
  const entityTypeById = new Map(entities.map((row) => [row.id, row.entityType]))

  let flagged = 0
  let removed = 0

  for (const edge of edges) {
    // Keep generic fallback relations; this checker focuses on typed predicates.
    if (edge.predicate === 'related_to') continue

    const allowedPairs = allowedPredicatePairs.get(edge.predicate)
    const sourceType = entityTypeById.get(edge.sourceId)
    const targetType = entityTypeById.get(edge.targetId)
    const hasTypes = Boolean(sourceType && targetType)
    const matchesRule =
      hasTypes && allowedPairs?.has(relationTypePairKey(sourceType!, targetType!)) === true
    const invalid = !matchesRule
    if (!invalid) continue

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
