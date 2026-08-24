/**
 * DeepSleep repair: reconnect co-mentioned entities missing ENTITY_RELATES edges.
 *
 * Ingest can miss triple extraction (e.g. "Space" and "Space Hamburg" in the same
 * thought with no graph edge). This job re-scans those thoughts and adds edges via
 * LLM re-extraction plus lexical containment heuristics for obvious name pairs.
 */

import { and, eq, isNotNull } from 'drizzle-orm'
import { pruneSuspiciousEntityEdgesForUser } from '$lib/server/consolidation/prune-suspicious-entity-edges'
import { getDb } from '$lib/server/db'
import { canonicalEntity, entityResolutionLog, thought } from '$lib/server/db/schema'
import { fetchEntityEdgesForUser, upsertEntityRelationEdge } from '$lib/server/graph/age'
import {
  extractEntityTriples,
  type ExtractedEntityMention,
} from '$lib/server/memory/entity-extraction'
import { upsertEntityRelationTriples } from '$lib/server/memory/entity-graph-sync'

const REPAIR_BATCH_SIZE = 20
const MIN_LEXICAL_KEY_LENGTH = 3

export type RepairEntityRelationsResult = {
  scanned: number
  gaps: number
  processed: number
  repaired: number
  edgesAdded: number
  suspiciousEdgesRemoved: number
}

export type RepairEntityRelationsOptions = {
  batchSize?: number
  shouldCancel?: () => boolean | Promise<boolean>
  onProgress?: (detail: { processed: number; total: number }) => void | Promise<void>
}

type CoMentionEntity = {
  entityId: string
  surface: string
  canonicalKey: string
  entityType: string
}

type CoMentionThought = {
  thoughtId: string
  normalizedText: string
  entities: CoMentionEntity[]
}

function undirectedEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function buildEdgeSet(edges: Array<{ sourceId: string; targetId: string }>): Set<string> {
  const set = new Set<string>()
  for (const edge of edges) {
    set.add(undirectedEdgeKey(edge.sourceId, edge.targetId))
  }
  return set
}

function hasUndirectedEdge(edgeSet: Set<string>, a: string, b: string): boolean {
  return edgeSet.has(undirectedEdgeKey(a, b))
}

function thoughtHasMissingCoMentionEdge(entityIds: string[], edgeSet: Set<string>): boolean {
  for (let i = 0; i < entityIds.length; i++) {
    for (let j = i + 1; j < entityIds.length; j++) {
      if (!hasUndirectedEdge(edgeSet, entityIds[i], entityIds[j])) return true
    }
  }
  return false
}

function countMissingPairs(entityIds: string[], edgeSet: Set<string>): number {
  let missing = 0
  for (let i = 0; i < entityIds.length; i++) {
    for (let j = i + 1; j < entityIds.length; j++) {
      if (!hasUndirectedEdge(edgeSet, entityIds[i], entityIds[j])) missing++
    }
  }
  return missing
}

function degreeByEntityFromEdges(
  edges: Array<{ sourceId: string; targetId: string }>,
): Map<string, number> {
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1)
  }
  return degree
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function inferLexicalRelation(
  a: CoMentionEntity,
  b: CoMentionEntity,
): { sourceEntityId: string; targetEntityId: string; predicate: string } | null {
  if (a.entityId === b.entityId) return null

  const shorter = a.canonicalKey.length <= b.canonicalKey.length ? a : b
  const longer = a.canonicalKey.length <= b.canonicalKey.length ? b : a
  if (shorter.canonicalKey.length < MIN_LEXICAL_KEY_LENGTH) return null

  const prefixPattern = new RegExp(`^${escapeRegex(shorter.canonicalKey)}(?:\\s|$)`)
  if (prefixPattern.test(longer.canonicalKey)) {
    return {
      sourceEntityId: longer.entityId,
      targetEntityId: shorter.entityId,
      predicate: 'part_of',
    }
  }

  if (
    longer.canonicalKey.includes(shorter.canonicalKey) ||
    shorter.canonicalKey.includes(longer.canonicalKey)
  ) {
    return {
      sourceEntityId: a.entityId,
      targetEntityId: b.entityId,
      predicate: 'related_to',
    }
  }

  return null
}

async function loadCoMentionThoughts(userId: string): Promise<CoMentionThought[]> {
  const db = getDb()
  const rows = await db
    .select({
      thoughtId: entityResolutionLog.thoughtId,
      canonicalEntityId: entityResolutionLog.canonicalEntityId,
      mentionSurface: entityResolutionLog.mentionSurface,
      label: canonicalEntity.label,
      canonicalKey: canonicalEntity.canonicalKey,
      entityType: canonicalEntity.entityType,
      normalizedText: thought.normalizedText,
    })
    .from(entityResolutionLog)
    .innerJoin(
      canonicalEntity,
      and(
        eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id),
        eq(canonicalEntity.userId, userId),
      ),
    )
    .innerJoin(
      thought,
      and(eq(entityResolutionLog.thoughtId, thought.id), eq(thought.userId, userId)),
    )
    .where(
      and(eq(entityResolutionLog.userId, userId), isNotNull(entityResolutionLog.canonicalEntityId)),
    )

  const byThought = new Map<
    string,
    { normalizedText: string; entities: Map<string, CoMentionEntity> }
  >()

  for (const row of rows) {
    const entityId = row.canonicalEntityId
    if (!entityId) continue
    let bucket = byThought.get(row.thoughtId)
    if (!bucket) {
      bucket = { normalizedText: row.normalizedText, entities: new Map() }
      byThought.set(row.thoughtId, bucket)
    }
    if (!bucket.entities.has(entityId)) {
      bucket.entities.set(entityId, {
        entityId,
        surface: row.mentionSurface.trim() || row.label,
        canonicalKey: row.canonicalKey,
        entityType: row.entityType,
      })
    }
  }

  return [...byThought.entries()]
    .filter(([, bucket]) => bucket.entities.size >= 2)
    .map(([thoughtId, bucket]) => ({
      thoughtId,
      normalizedText: bucket.normalizedText,
      entities: [...bucket.entities.values()],
    }))
}

async function repairThoughtCoMentionEdges(input: {
  userId: string
  thought: CoMentionThought
  edgeSet: Set<string>
}): Promise<number> {
  const entityIds = input.thought.entities.map((e) => e.entityId)
  if (!thoughtHasMissingCoMentionEdge(entityIds, input.edgeSet)) return 0

  const mentions: ExtractedEntityMention[] = input.thought.entities.map((e) => ({
    surface: e.surface,
    entityType: e.entityType,
    confidence: 1,
  }))
  const surfaceToEntityId = new Map(input.thought.entities.map((e) => [e.surface, e.entityId]))

  const triples = await extractEntityTriples({
    userId: input.userId,
    normalizedText: input.thought.normalizedText,
    mentions,
  })

  let edgesAdded = await upsertEntityRelationTriples({
    userId: input.userId,
    normalizedText: input.thought.normalizedText,
    mentions,
    surfaceToEntityId,
    triples,
  })

  for (const triple of triples) {
    const sourceId = surfaceToEntityId.get(triple.subject.trim())
    const targetId = surfaceToEntityId.get(triple.object.trim())
    if (sourceId && targetId) {
      input.edgeSet.add(undirectedEdgeKey(sourceId, targetId))
    }
  }

  for (let i = 0; i < input.thought.entities.length; i++) {
    for (let j = i + 1; j < input.thought.entities.length; j++) {
      const a = input.thought.entities[i]
      const b = input.thought.entities[j]
      if (hasUndirectedEdge(input.edgeSet, a.entityId, b.entityId)) continue

      const inferred = inferLexicalRelation(a, b)
      if (!inferred) continue

      await upsertEntityRelationEdge({
        userId: input.userId,
        sourceEntityId: inferred.sourceEntityId,
        targetEntityId: inferred.targetEntityId,
        predicate: inferred.predicate,
      })
      input.edgeSet.add(undirectedEdgeKey(inferred.sourceEntityId, inferred.targetEntityId))
      edgesAdded++
    }
  }

  return edgesAdded
}

/**
 * Scan thoughts whose co-mentioned entities lack graph edges and repair them.
 */
export async function repairEntityRelationsForUser(
  userId: string,
  options?: RepairEntityRelationsOptions,
): Promise<RepairEntityRelationsResult> {
  const batchSize = options?.batchSize ?? REPAIR_BATCH_SIZE
  const pruned = await pruneSuspiciousEntityEdgesForUser(userId)
  const coMentionThoughts = await loadCoMentionThoughts(userId)
  const scanned = coMentionThoughts.length
  if (scanned === 0) {
    return {
      scanned: 0,
      gaps: 0,
      processed: 0,
      repaired: 0,
      edgesAdded: 0,
      suspiciousEdgesRemoved: pruned.removed,
    }
  }

  const edges = await fetchEntityEdgesForUser({ userId })
  const edgeSet = buildEdgeSet(edges)
  const degreeByEntity = degreeByEntityFromEdges(edges)
  const gapThoughts = coMentionThoughts.filter((t) =>
    thoughtHasMissingCoMentionEdge(
      t.entities.map((e) => e.entityId),
      edgeSet,
    ),
  )
  const prioritized = gapThoughts
    .map((t) => {
      const ids = t.entities.map((e) => e.entityId)
      const missingPairs = countMissingPairs(ids, edgeSet)
      const bridgeScore = ids.reduce((score, entityId) => {
        const degree = degreeByEntity.get(entityId) ?? 0
        return score + (degree === 0 ? 2 : degree <= 2 ? 1 : 0)
      }, 0)
      return { thought: t, missingPairs, bridgeScore }
    })
    .sort(
      (a, b) =>
        b.bridgeScore - a.bridgeScore ||
        b.missingPairs - a.missingPairs ||
        b.thought.entities.length - a.thought.entities.length,
    )

  const processingBudget = Math.max(batchSize, Math.min(gapThoughts.length, batchSize * 3))
  let processed = 0
  let repaired = 0
  let edgesAdded = 0

  await options?.onProgress?.({ processed: 0, total: processingBudget })

  for (const row of prioritized.slice(0, processingBudget)) {
    if (options?.shouldCancel && (await options.shouldCancel())) break
    processed++

    const added = await repairThoughtCoMentionEdges({
      userId,
      thought: row.thought,
      edgeSet,
    })
    if (added > 0) {
      repaired++
      edgesAdded += added
    }

    await options?.onProgress?.({ processed, total: processingBudget })
  }

  return {
    scanned,
    gaps: gapThoughts.length,
    processed,
    repaired,
    edgesAdded,
    suspiciousEdgesRemoved: pruned.removed,
  }
}
