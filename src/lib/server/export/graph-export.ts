import { asc, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  temporalEvent,
  thought,
  thoughtEntity,
  thoughtRelation,
} from '$lib/server/db/schema'
import {
  fetchEntityEdgesForUser,
  fetchInvolvesEdgesForUser,
  fetchOccursInEdgesForUser,
} from '$lib/server/graph/age'

export type GraphExportPayload = {
  userId: string
  counts: Record<string, number>
  thoughts: Array<{ id: string; category: string }>
  entities: Array<{
    id: string
    canonical_key: string
    label: string
    entity_type: string
  }>
  events: Array<{
    id: string
    kind: string
    label: string
    start_at: string
    end_at: string
  }>
  relates_to: Array<{
    source_id: string
    target_id: string
    relation_type: string
  }>
  mentions: Array<{ thought_id: string; entity_id: string }>
  entity_relates: Array<{
    source_id: string
    target_id: string
    predicate: string
    weight: number
  }>
  occurs_in: Array<{ thought_id: string; event_id: string }>
  involves: Array<{ event_id: string; entity_id: string }>
}

export async function buildGraphExportJson(userId: string): Promise<GraphExportPayload> {
  const db = getDb()

  const [
    thoughtRows,
    entityRows,
    relationRows,
    mentionRows,
    eventRows,
    entityRelates,
    occursIn,
    involvesEdges,
  ] = await Promise.all([
    db
      .select({ id: thought.id, category: thought.category })
      .from(thought)
      .where(eq(thought.userId, userId))
      .orderBy(asc(thought.createdAt), asc(thought.id)),
    db
      .select({
        id: canonicalEntity.id,
        canonicalKey: canonicalEntity.canonicalKey,
        label: canonicalEntity.label,
        entityType: canonicalEntity.entityType,
      })
      .from(canonicalEntity)
      .where(eq(canonicalEntity.userId, userId))
      .orderBy(asc(canonicalEntity.createdAt), asc(canonicalEntity.id)),
    db
      .select({
        sourceThoughtId: thoughtRelation.sourceThoughtId,
        targetThoughtId: thoughtRelation.targetThoughtId,
        relationType: thoughtRelation.relationType,
      })
      .from(thoughtRelation)
      .where(eq(thoughtRelation.userId, userId)),
    db
      .select({
        thoughtId: thoughtEntity.thoughtId,
        entityId: thoughtEntity.entityId,
      })
      .from(thoughtEntity)
      .where(eq(thoughtEntity.userId, userId)),
    db
      .select({
        id: temporalEvent.id,
        kind: temporalEvent.kind,
        semanticSummary: temporalEvent.semanticSummary,
        startAt: temporalEvent.startAt,
        endAt: temporalEvent.endAt,
      })
      .from(temporalEvent)
      .where(eq(temporalEvent.userId, userId))
      .orderBy(asc(temporalEvent.createdAt), asc(temporalEvent.id)),
    fetchEntityEdgesForUser({ userId }),
    fetchOccursInEdgesForUser({ userId }),
    fetchInvolvesEdgesForUser({ userId }),
  ])

  const thoughts = thoughtRows.map((row) => ({
    id: row.id,
    category: row.category,
  }))

  const entities = entityRows.map((row) => ({
    id: row.id,
    canonical_key: row.canonicalKey,
    label: row.label,
    entity_type: row.entityType,
  }))

  const events = eventRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.semanticSummary,
    start_at: row.startAt?.toISOString() ?? '',
    end_at: row.endAt?.toISOString() ?? '',
  }))

  const relates_to = relationRows.map((row) => ({
    source_id: row.sourceThoughtId,
    target_id: row.targetThoughtId,
    relation_type: row.relationType,
  }))

  const mentions = mentionRows.map((row) => ({
    thought_id: row.thoughtId,
    entity_id: row.entityId,
  }))

  const entity_relates = entityRelates.map((row) => ({
    source_id: row.sourceId,
    target_id: row.targetId,
    predicate: row.predicate,
    weight: row.weight,
  }))

  const occurs_in = occursIn.map((row) => ({
    thought_id: row.thoughtId,
    event_id: row.eventId,
  }))

  const involves = involvesEdges.map((row) => ({
    event_id: row.eventId,
    entity_id: row.entityId,
  }))

  const payload: GraphExportPayload = {
    userId,
    thoughts,
    entities,
    events,
    relates_to,
    mentions,
    entity_relates,
    occurs_in,
    involves,
    counts: {
      thoughts: thoughts.length,
      entities: entities.length,
      events: events.length,
      relates_to: relates_to.length,
      mentions: mentions.length,
      entity_relates: entity_relates.length,
      occurs_in: occurs_in.length,
      involves: involves.length,
    },
  }

  return payload
}
