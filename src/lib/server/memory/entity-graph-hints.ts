import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity, entityResolutionLog } from '$lib/server/db/schema'
import { fetchEntityEdgesForUser } from '$lib/server/graph/age'
import type { KnownEntityHint } from '$lib/server/memory/entity-extraction'
import { buildEntityAdjacency, neighborEntityIds } from '$lib/server/memory/entity-link-graph'
import { tokenizeLexicalQuery } from '$lib/server/memory/lexical-fold'
import { computeLexicalText } from '$lib/server/memory/lexical-text'

const GRAPH_HINT_LIMIT = 12

const LEXICAL_HINT_SCAN_LIMIT = 200

/** Whole-token match for single-word labels; phrase match for multi-word labels. */
export function lexicalLabelAppearsInText(normalizedText: string, label: string): boolean {
  const labelKey = computeLexicalText(label)
  if (!labelKey) return false
  const labelTokens = labelKey.split(' ').filter((t) => t.length > 0)
  if (labelTokens.length === 1) {
    return tokenizeLexicalQuery(normalizedText).includes(labelTokens[0]!)
  }
  return computeLexicalText(normalizedText).includes(labelKey)
}

/**
 * Known-entity hints from graph context (same-thought resolutions + ENTITY_RELATES neighbors).
 * Does not use embedding similarity.
 */
export async function loadGraphKnownEntityHints(input: {
  userId: string
  thoughtId: string
}): Promise<KnownEntityHint[]> {
  const db = getDb()
  const resolved = await db
    .select({
      entityId: entityResolutionLog.canonicalEntityId,
      label: canonicalEntity.label,
      entityType: canonicalEntity.entityType,
    })
    .from(entityResolutionLog)
    .innerJoin(
      canonicalEntity,
      and(
        eq(entityResolutionLog.canonicalEntityId, canonicalEntity.id),
        eq(canonicalEntity.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(entityResolutionLog.userId, input.userId),
        eq(entityResolutionLog.thoughtId, input.thoughtId),
        isNotNull(entityResolutionLog.canonicalEntityId),
      ),
    )

  const byId = new Map<string, KnownEntityHint>()
  for (const row of resolved) {
    if (!row.entityId) continue
    byId.set(row.entityId, {
      entityId: row.entityId,
      label: row.label,
      entityType: row.entityType,
    })
  }

  const seedIds = [...byId.keys()]
  if (seedIds.length === 0) return []

  const edges = await fetchEntityEdgesForUser({ userId: input.userId })
  const adjacency = buildEntityAdjacency(edges)
  const neighborIds = neighborEntityIds(adjacency, seedIds)

  const missingNeighborIds = [...neighborIds]
    .filter((id) => !byId.has(id))
    .slice(0, GRAPH_HINT_LIMIT)
  if (missingNeighborIds.length > 0) {
    const rows = await db
      .select({
        id: canonicalEntity.id,
        label: canonicalEntity.label,
        entityType: canonicalEntity.entityType,
      })
      .from(canonicalEntity)
      .where(
        and(
          eq(canonicalEntity.userId, input.userId),
          inArray(canonicalEntity.id, missingNeighborIds),
        ),
      )

    for (const row of rows) {
      byId.set(row.id, {
        entityId: row.id,
        label: row.label,
        entityType: row.entityType,
      })
    }
  }

  return [...byId.values()].slice(0, GRAPH_HINT_LIMIT)
}

/**
 * Canonical entities whose labels appear in the thought text (lexical recall only — types from DB).
 */
export async function loadLexicalCanonicalEntityHints(input: {
  userId: string
  normalizedText: string
  limit?: number
}): Promise<KnownEntityHint[]> {
  const textKey = computeLexicalText(input.normalizedText)
  if (!textKey) return []

  const hintLimit = input.limit ?? GRAPH_HINT_LIMIT

  const rows = await getDb()
    .select({
      id: canonicalEntity.id,
      label: canonicalEntity.label,
      entityType: canonicalEntity.entityType,
    })
    .from(canonicalEntity)
    .where(eq(canonicalEntity.userId, input.userId))
    .limit(LEXICAL_HINT_SCAN_LIMIT)

  const hints: KnownEntityHint[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const label = typeof row.label === 'string' ? row.label.trim() : ''
    if (label.length < 2) continue
    if (!lexicalLabelAppearsInText(input.normalizedText, label)) continue
    const labelKey = computeLexicalText(label)
    const dedupe = `${labelKey}\0${row.entityType}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    hints.push({ entityId: row.id, label, entityType: row.entityType })
    if (hints.length >= hintLimit) break
  }
  return hints
}

/**
 * XXX REMOVED — text-derived entity hints (proper-noun regex → person, allergy/needs regex → concept).
 * Violated no-string-heuristics: semantic types must come from LLM extraction, not code pattern matching.
 * See .cursor/rules/no-string-heuristics.mdc
 */
export function loadTextDerivedEntityHints(_normalizedText: string): KnownEntityHint[] {
  return []
}

/**
 * Pre-ingest entity hints from the user's canonical entity index (lexical match only).
 */
export async function loadIngestKnownEntityHints(input: {
  userId: string
  normalizedText: string
}): Promise<KnownEntityHint[]> {
  return loadLexicalCanonicalEntityHints({
    userId: input.userId,
    normalizedText: input.normalizedText,
  })
}

/** Graph neighbors for this thought plus lexical matches from the user's entity index. */
export async function loadEntityHintsForThought(input: {
  userId: string
  thoughtId: string
  normalizedText: string
}): Promise<KnownEntityHint[]> {
  const [graphHints, lexicalHints] = await Promise.all([
    loadGraphKnownEntityHints({ userId: input.userId, thoughtId: input.thoughtId }),
    loadLexicalCanonicalEntityHints({
      userId: input.userId,
      normalizedText: input.normalizedText,
    }),
  ])

  const byId = new Map<string, KnownEntityHint>()
  for (const hint of [...graphHints, ...lexicalHints]) {
    const id = hint.entityId ?? computeLexicalText(hint.label)
    if (!id || byId.has(id)) continue
    byId.set(id, hint)
  }
  return [...byId.values()].slice(0, GRAPH_HINT_LIMIT)
}
