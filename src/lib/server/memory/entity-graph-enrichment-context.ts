/**
 * Semantic graph context for tier-2 entity extraction (not recency-biased).
 * Caps each source so prompts stay bounded (~5 per category).
 */
import { and, eq, inArray } from 'drizzle-orm'
import type { EnrichmentCommunityExcerpt } from '$lib/server/capture/enrichment-context'
import { getDb } from '$lib/server/db'
import { canonicalEntity } from '$lib/server/db/schema'
import { fetchEntityEdgesForUser } from '$lib/server/graph/age'
import type { GroundingProfileForEnrichment } from '$lib/server/grounding/types'
import { loadLexicalCanonicalEntityHints } from '$lib/server/memory/entity-graph-hints'
import { buildEntityAdjacency, neighborEntityIds } from '$lib/server/memory/entity-link-graph'
import { matchCanonicalEntitiesByEmbedding } from '$lib/server/memory/entity-resolution'
import { computeLexicalText } from '$lib/server/memory/lexical-text'

/** Max candidates per provenance source before deduplication. */
export const ENTITY_ENRICHMENT_LIMIT_PER_SOURCE = 5

/** Max graph entity rows passed to the extraction LLM after merge. */
export const ENTITY_ENRICHMENT_GRAPH_ENTITY_CAP = 12

/** Max community summary excerpts in the entity extraction prompt. */
export const ENTITY_ENRICHMENT_COMMUNITY_CAP = 5

/** Same distance gate as retrieval entity ANN expansion. */
export const ENTITY_EMBEDDING_MATCH_MAX_DISTANCE = 0.48

export type GraphEntityCandidateSource = 'lexical' | 'embedding' | 'graph_neighbor'

export type GraphEntityCandidate = {
  entityId: string
  label: string
  entityType: string
  source: GraphEntityCandidateSource
}

export type EntityGraphEnrichmentContext = {
  graphEntities: GraphEntityCandidate[]
  communityExcerpts: EnrichmentCommunityExcerpt[]
  groundingProfile: GroundingProfileForEnrichment
}

export function formatCommunityExcerptsForEntityPrompt(
  excerpts: EnrichmentCommunityExcerpt[],
): string {
  if (excerpts.length === 0) return ''
  const lines = excerpts.map(
    (c, i) =>
      `${i + 1}. [community ${c.communityId.slice(0, 8)}… L${c.level}] ${c.summaryText.slice(0, 400)}${c.summaryText.length > 400 ? '…' : ''}`,
  )
  return [
    'Relevant memory themes (community summaries — semantic context for what the user cares about):',
    ...lines,
  ].join('\n')
}

export function formatKnownGraphEntitiesPromptBlock(entities: GraphEntityCandidate[]): string {
  if (entities.length === 0) return ''
  const lines = entities.map(
    (e) =>
      `- id=${e.entityId} label="${e.label}" type=${e.entityType} (already in graph; source=${e.source})`,
  )
  return [
    'Existing graph entities relevant to this capture (already persisted — reuse these IDs by extracting matching surfaces; do not invent duplicate hubs):',
    ...lines,
    'When the text clearly refers to one of these entities, extract a mention with the surface as written in the text.',
    'Triples may use a graph entity label as object or subject when wiring to an existing node (e.g. fish part_of picnic).',
  ].join('\n')
}

function mergeGraphEntityCandidates(...groups: GraphEntityCandidate[][]): GraphEntityCandidate[] {
  const byId = new Map<string, GraphEntityCandidate>()
  for (const group of groups) {
    for (const row of group) {
      if (!row.entityId || byId.has(row.entityId)) continue
      byId.set(row.entityId, row)
      if (byId.size >= ENTITY_ENRICHMENT_GRAPH_ENTITY_CAP) {
        return [...byId.values()]
      }
    }
  }
  return [...byId.values()]
}

async function loadGraphNeighborCandidates(input: {
  userId: string
  seedEntityIds: string[]
  limit: number
}): Promise<GraphEntityCandidate[]> {
  if (input.seedEntityIds.length === 0 || input.limit <= 0) return []

  const edges = await fetchEntityEdgesForUser({ userId: input.userId })
  const adjacency = buildEntityAdjacency(edges)
  const neighborIds = [...neighborEntityIds(adjacency, input.seedEntityIds)]
    .filter((id) => !input.seedEntityIds.includes(id))
    .slice(0, input.limit)

  if (neighborIds.length === 0) return []

  const rows = await getDb()
    .select({
      id: canonicalEntity.id,
      label: canonicalEntity.label,
      entityType: canonicalEntity.entityType,
    })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, input.userId), inArray(canonicalEntity.id, neighborIds)))

  return rows.map((row) => ({
    entityId: row.id,
    label: row.label,
    entityType: row.entityType,
    source: 'graph_neighbor' as const,
  }))
}

async function loadEmbeddingGraphCandidates(input: {
  userId: string
  thoughtEmbedding: number[]
  limit: number
}): Promise<GraphEntityCandidate[]> {
  const matches = await matchCanonicalEntitiesByEmbedding({
    userId: input.userId,
    embedding: input.thoughtEmbedding,
    limit: Math.max(input.limit, ENTITY_ENRICHMENT_LIMIT_PER_SOURCE),
  })

  return matches
    .filter((m) => m.distance < ENTITY_EMBEDDING_MATCH_MAX_DISTANCE)
    .slice(0, input.limit)
    .map((m) => ({
      entityId: m.id,
      label: m.label,
      entityType: m.entityType,
      source: 'embedding' as const,
    }))
}

/** Build capped semantic graph context for entity extraction. */
export async function loadEntityGraphEnrichmentContext(input: {
  userId: string
  normalizedText: string
  thoughtEmbedding?: number[]
  communityExcerpts: EnrichmentCommunityExcerpt[]
  groundingProfile: GroundingProfileForEnrichment
}): Promise<EntityGraphEnrichmentContext> {
  const lexicalHints = await loadLexicalCanonicalEntityHints({
    userId: input.userId,
    normalizedText: input.normalizedText,
    limit: ENTITY_ENRICHMENT_LIMIT_PER_SOURCE,
  })

  const lexicalCandidates: GraphEntityCandidate[] = lexicalHints
    .filter((h) => Boolean(h.entityId))
    .map((h) => ({
      entityId: h.entityId!,
      label: h.label,
      entityType: h.entityType,
      source: 'lexical' as const,
    }))

  const embeddingCandidates =
    input.thoughtEmbedding && input.thoughtEmbedding.length > 0
      ? await loadEmbeddingGraphCandidates({
          userId: input.userId,
          thoughtEmbedding: input.thoughtEmbedding,
          limit: ENTITY_ENRICHMENT_LIMIT_PER_SOURCE,
        })
      : []

  const seedIds = [
    ...new Set([...lexicalCandidates, ...embeddingCandidates].map((c) => c.entityId)),
  ]
  const neighborCandidates = await loadGraphNeighborCandidates({
    userId: input.userId,
    seedEntityIds: seedIds,
    limit: ENTITY_ENRICHMENT_LIMIT_PER_SOURCE,
  })

  const graphEntities = mergeGraphEntityCandidates(
    lexicalCandidates,
    embeddingCandidates,
    neighborCandidates,
  )

  return {
    graphEntities,
    communityExcerpts: input.communityExcerpts.slice(0, ENTITY_ENRICHMENT_COMMUNITY_CAP),
    groundingProfile: input.groundingProfile,
  }
}

/** Map graph entity labels (and lexical keys) to canonical entity IDs for triple wiring. */
export function graphEntityIdByLabel(entities: GraphEntityCandidate[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const entity of entities) {
    const label = entity.label.trim()
    if (!label) continue
    map.set(label, entity.entityId)
    const key = computeLexicalText(label)
    if (key) map.set(key, entity.entityId)
  }
  return map
}
