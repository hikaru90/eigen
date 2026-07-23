/**
 * Unified retrieval — one path for MCP, HTTP, and compose.
 *
 * Query time: embed once → parallel ANN/FTS → bundle/key fetch → weighted merge → rerank.
 * No live AGE graph traversal.
 */

import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { MemoryAuthor } from '$lib/server/db/schema'
import { COMMUNITY_MID_LEVEL } from '$lib/server/consolidation/community-levels'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { getDb } from '$lib/server/db'
import {
  communityBundle,
  communitySummary,
  entityTopThoughts,
  thought,
  thoughtNeighbor,
} from '$lib/server/db/schema'
import { activeThoughtLifecycleCondition } from '$lib/server/memory/thought-lifecycle-filter'
import { lexicalSearch } from '$lib/server/retrieval/lexical'
import { matchCanonicalEntitiesByEmbedding } from '$lib/server/memory/entity-resolution'
import {
  rerankCandidates,
  shouldSkipRerank,
  type RerankCandidate,
} from '$lib/server/retrieval/reranker'
import { createPhaseTimer, logRetrievalPhaseTiming } from '$lib/server/retrieval/phase-timing'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import {
  filterTemporalEvents,
  fetchTemporalEventSeeds,
  isTemporalQuery,
  resolveQueryTimeRange,
  traverseTemporalContext,
  type TemporalEventSeed,
  type TemporalQueryIntent,
  type TemporalSearchHit,
} from '$lib/server/retrieval/temporal'
import type { RetrievalResult } from '$lib/server/retrieval/service'
import type { RelevantCommunitySummary } from '$lib/server/retrieval/global'

/** Optional bag filled by retrieveEvidence so callers can reuse ANN side-channels. */
export type RetrieveEvidenceExtras = {
  communityThemes: RelevantCommunitySummary[]
  temporalSeeds: TemporalEventSeed[]
}

const THOUGHT_ANN_LIMIT = 30
const COMMUNITY_ANN_LIMIT = 12
const ENTITY_ANN_LIMIT = 20
const NEIGHBOR_PER_SEED = 2
const MERGE_CANDIDATE_CAP = 80
const RERANK_POOL = 15

/**
 * Weights for the weighted merge (sum = 1.0). A flat TEMPORAL_BOOST is added on top for
 * temporal-intent hits, so the raw merge score tops out at 1.0 + TEMPORAL_BOOST = 1.18;
 * `normalizeRetrievalScore` clamps to [0, 1] by design for MCP threshold filtering.
 */
const SCORE_WEIGHTS = {
  thoughtSim: 0.42,
  communitySim: 0.25,
  entitySim: 0.1,
  centrality: 0.08,
  specificity: 0.05,
  salience: 0.04,
  recency: 0.06,
} as const

/** Flat additive boost for temporal-intent hits (outside SCORE_WEIGHTS, see note above). */
const TEMPORAL_BOOST = 0.18

const SALIENCE_MAX = 5.0
const SALIENCE_BOOST = 0.05

async function bumpAccessAsync(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await getDb()
      .update(thought)
      .set({
        accessCount: sql`${thought.accessCount} + 1`,
        lastAccessedAt: new Date(),
        salienceScore: sql`LEAST(${thought.salienceScore} + ${SALIENCE_BOOST}, ${SALIENCE_MAX})`,
      })
      .where(and(eq(thought.userId, userId), inArray(thought.id, ids)))
  } catch (err) {
    console.warn('[retrieval.reconsolidation] salience bump failed', {
      userId,
      count: ids.length,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}

function cosineSimilarityFromDistance(distance: number): number {
  return Math.max(0, 1 - distance)
}

type CandidateSource =
  'vector' | 'lexical' | 'community_bundle' | 'entity_top' | 'neighbor' | 'temporal'

type ScoredCandidate = {
  id: string
  sources: Set<CandidateSource>
  vectorDistance?: number
  communityDistance?: number
  entityDistance?: number
  /** Postgres `ts_rank_cd` when surfaced by lexical FTS. */
  lexicalScore?: number
}

/** Map raw FTS rank to a thought-similarity scale comparable with vector cosine sim. */
export function normalizeLexicalRank(raw: number): number {
  if (raw <= 0) return 0
  return Math.min(1, raw * 2.5)
}

function candidateHasDirectRelevance(candidate: ScoredCandidate): boolean {
  return candidate.sources.has('lexical') || candidate.sources.has('vector')
}

function computeThoughtSimilarity(candidate: ScoredCandidate): number {
  const vectorSim =
    candidate.vectorDistance !== undefined
      ? cosineSimilarityFromDistance(candidate.vectorDistance)
      : undefined
  const lexicalSim =
    candidate.lexicalScore !== undefined && candidate.lexicalScore > 0
      ? normalizeLexicalRank(candidate.lexicalScore)
      : undefined

  if (vectorSim !== undefined && lexicalSim !== undefined) {
    return Math.max(vectorSim, lexicalSim)
  }
  if (lexicalSim !== undefined) return lexicalSim
  if (vectorSim !== undefined) return vectorSim
  return candidate.sources.has('lexical') ? 0.35 : 0.2
}

/** Graph/community features apply only when the row also matched the query directly. */
function directRelevanceMultiplier(candidate: ScoredCandidate): number {
  return candidateHasDirectRelevance(candidate) ? 1 : 0
}

const LEXICAL_RERANK_RESERVE = 5

function buildRerankPool<T extends { candidate: ScoredCandidate; score: number }>(
  scored: T[],
): T[] {
  const byScore = [...scored].sort((a, b) => b.score - a.score)
  const byLexical = [...scored]
    .filter((e) => e.candidate.sources.has('lexical'))
    .sort((a, b) => (b.candidate.lexicalScore ?? 0) - (a.candidate.lexicalScore ?? 0))

  const pool: T[] = []
  const seen = new Set<string>()

  for (const entry of byLexical.slice(0, LEXICAL_RERANK_RESERVE)) {
    if (seen.has(entry.candidate.id)) continue
    pool.push(entry)
    seen.add(entry.candidate.id)
  }
  for (const entry of byScore) {
    if (pool.length >= RERANK_POOL) break
    if (seen.has(entry.candidate.id)) continue
    pool.push(entry)
    seen.add(entry.candidate.id)
  }
  return pool
}

function prioritizeMergeCandidates(candidates: Map<string, ScoredCandidate>): ScoredCandidate[] {
  const lexical: ScoredCandidate[] = []
  const vector: ScoredCandidate[] = []
  const rest: ScoredCandidate[] = []

  for (const c of candidates.values()) {
    if (c.sources.has('lexical')) lexical.push(c)
    else if (c.sources.has('vector')) vector.push(c)
    else rest.push(c)
  }

  lexical.sort((a, b) => (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0))
  vector.sort((a, b) => (a.vectorDistance ?? Infinity) - (b.vectorDistance ?? Infinity))

  return [...lexical, ...vector, ...rest].slice(0, MERGE_CANDIDATE_CAP)
}

const REDUNDANCY_BUNDLE_PENALTY = 0.05
const REDUNDANCY_CROWDED_PENALTY = 0.02
/** A community with more than this many candidates in the pool is crowded. */
const REDUNDANCY_CROWDED_MIN_ROWS = 2
const REDUNDANCY_PENALTY_MAX = 0.15

/**
 * Count each community at most once per candidate row — duplicate ids inside a row's
 * `primaryCommunityIds` must not inflate crowding.
 */
function countCandidatesPerCommunity(
  rows: Array<{ primaryCommunityIds: string[] | null }>,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const communityId of new Set(row.primaryCommunityIds ?? [])) {
      counts.set(communityId, (counts.get(communityId) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Deterministic redundancy penalty: bundle-sourced candidates pay a flat surcharge;
 * community-linked candidates pay per *own* crowded community. Computed from pool-wide
 * counts, so the result is independent of candidate iteration order.
 */
function redundancyPenalty(
  candidate: ScoredCandidate,
  row: { primaryCommunityIds: string[] | null },
  communityCounts: Map<string, number>,
): number {
  let penalty = candidate.sources.has('community_bundle') ? REDUNDANCY_BUNDLE_PENALTY : 0
  if (candidate.communityDistance !== undefined) {
    for (const communityId of new Set(row.primaryCommunityIds ?? [])) {
      if ((communityCounts.get(communityId) ?? 0) > REDUNDANCY_CROWDED_MIN_ROWS) {
        penalty += REDUNDANCY_CROWDED_PENALTY
      }
    }
  }
  return Math.min(REDUNDANCY_PENALTY_MAX, penalty)
}

async function fetchCommunityAnn(
  userId: string,
  queryEmbedding: number[],
  limit: number,
): Promise<Array<{ communityId: string; distance: number; level: number; summaryText: string }>> {
  const vectorLiteral = toVectorLiteral(queryEmbedding)
  const distanceExpr = sql<number>`${communitySummary.summaryEmbedding} <=> ${vectorLiteral}::vector`
  const db = getDb()
  const rows = await db
    .select({
      communityId: communitySummary.communityId,
      distance: distanceExpr,
      level: communitySummary.level,
      summaryText: communitySummary.summaryText,
    })
    .from(communitySummary)
    .where(
      and(
        eq(communitySummary.userId, userId),
        eq(communitySummary.level, COMMUNITY_MID_LEVEL),
        isNotNull(communitySummary.summaryEmbedding),
      ),
    )
    .orderBy(distanceExpr)
    .limit(limit)
  return rows
}

export async function retrieveEvidence(params: {
  userId: string
  query: string
  topK?: number
  queryEmbedding?: number[]
  temporalIntent?: TemporalQueryIntent | null
  /** Optional filter — omit to include both user and agent-authored thoughts. */
  authorFilter?: MemoryAuthor
  /**
   * When provided, filled with community ANN summaries and temporal seeds so
   * composeAnswer (and similar) can reuse them without a second HNSW round-trip.
   */
  extrasOut?: RetrieveEvidenceExtras
}): Promise<RetrievalResult[]> {
  const timer = createPhaseTimer()
  const limit = Math.max(1, Math.min(params.topK ?? 12, 100))
  const authorFilter = params.authorFilter

  timer.mark('embed')
  const queryEmbedding =
    params.queryEmbedding ?? (await createThoughtEmbedding(params.userId, params.query))
  const vectorLiteral = toVectorLiteral(queryEmbedding)
  const vectorDistance = sql<number>`${thought.embedding} <=> ${vectorLiteral}::vector`

  timer.mark('vector')
  timer.mark('lexical')
  timer.mark('entity')

  const db = getDb()
  const vectorQuery = db
    .select({
      id: thought.id,
      distance: vectorDistance,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, params.userId),
        activeThoughtLifecycleCondition(),
        isNotNull(thought.embedding),
        authorFilter ? eq(thought.author, authorFilter) : undefined,
      ),
    )
    .orderBy(vectorDistance)
    .limit(THOUGHT_ANN_LIMIT)

  const lexicalQuery = lexicalSearch({
    userId: params.userId,
    query: params.query,
    limit: THOUGHT_ANN_LIMIT,
    authorFilter,
  })

  const entityQuery = matchCanonicalEntitiesByEmbedding({
    userId: params.userId,
    embedding: queryEmbedding,
    limit: ENTITY_ANN_LIMIT,
  })

  const communityQuery = fetchCommunityAnn(params.userId, queryEmbedding, COMMUNITY_ANN_LIMIT)

  const temporalEnabled = isTemporalQuery(params.temporalIntent)
  const queryRange = resolveQueryTimeRange(params.temporalIntent)

  const temporalQuery = temporalEnabled
    ? filterTemporalEvents({
        userId: params.userId,
        query: params.query,
        queryEmbedding,
        queryRange,
        limit: 15,
      })
    : Promise.resolve([] as TemporalSearchHit[])

  const temporalSeedQuery = temporalEnabled
    ? fetchTemporalEventSeeds({
        userId: params.userId,
        query: params.query,
        queryEmbedding,
        limit: 24,
      }).then((result) => result.seeds)
    : Promise.resolve([] as TemporalEventSeed[])

  const [vectorRows, lexicalRows, entityMatches, communities, temporalHits, temporalSeeds] =
    await Promise.all([
      vectorQuery,
      lexicalQuery,
      entityQuery,
      communityQuery,
      temporalQuery,
      temporalSeedQuery,
    ])

  if (params.extrasOut) {
    params.extrasOut.communityThemes = communities.slice(0, 6).map((c) => ({
      communityId: c.communityId,
      level: c.level,
      summaryText: c.summaryText,
    }))
    params.extrasOut.temporalSeeds = temporalSeeds
  }

  const candidates = new Map<string, ScoredCandidate>()

  const addCandidate = (id: string, source: CandidateSource, patch?: Partial<ScoredCandidate>) => {
    const existing = candidates.get(id) ?? { id, sources: new Set<CandidateSource>() }
    existing.sources.add(source)
    if (patch?.vectorDistance !== undefined) existing.vectorDistance = patch.vectorDistance
    if (patch?.communityDistance !== undefined)
      existing.communityDistance = Math.min(
        existing.communityDistance ?? Infinity,
        patch.communityDistance,
      )
    if (patch?.entityDistance !== undefined)
      existing.entityDistance = Math.min(existing.entityDistance ?? Infinity, patch.entityDistance)
    if (patch?.lexicalScore !== undefined) {
      existing.lexicalScore = Math.max(existing.lexicalScore ?? 0, patch.lexicalScore)
    }
    candidates.set(id, existing)
  }

  for (const row of vectorRows) {
    addCandidate(row.id, 'vector', { vectorDistance: row.distance })
  }
  for (const row of lexicalRows) {
    addCandidate(row.id, 'lexical', { lexicalScore: row.lexicalScore })
  }
  for (const hit of temporalHits) {
    addCandidate(hit.thoughtId, 'temporal')
  }
  for (const seed of temporalSeeds) {
    addCandidate(seed.thoughtId, 'temporal')
  }

  if (temporalEnabled && temporalHits.length > 0) {
    const expanded = await traverseTemporalContext({
      userId: params.userId,
      seeds: temporalHits,
      limit: 40,
    })
    for (const row of expanded) {
      addCandidate(row.thoughtId, 'temporal')
    }
  }

  const ENTITY_MATCH_MAX_DISTANCE = 0.48
  const matchedEntityIds = entityMatches
    .filter((m) => m.distance < ENTITY_MATCH_MAX_DISTANCE)
    .map((m) => m.id)

  timer.mark('graph')

  const communityIds = communities.map((c) => c.communityId)
  const communityDistanceById = new Map(communities.map((c) => [c.communityId, c.distance]))

  if (communityIds.length > 0) {
    const bundles = await db
      .select({
        communityId: communityBundle.communityId,
        topThoughtIds: communityBundle.topThoughtIds,
      })
      .from(communityBundle)
      .where(
        and(
          eq(communityBundle.userId, params.userId),
          inArray(communityBundle.communityId, communityIds),
        ),
      )

    for (const bundle of bundles) {
      const dist = communityDistanceById.get(bundle.communityId) ?? 1
      bundle.topThoughtIds.forEach((thoughtId) => {
        addCandidate(thoughtId, 'community_bundle', {
          communityDistance: dist,
        })
      })
    }
  }

  if (matchedEntityIds.length > 0) {
    const entityTops = await db
      .select({
        entityId: entityTopThoughts.entityId,
        thoughtIds: entityTopThoughts.thoughtIds,
      })
      .from(entityTopThoughts)
      .where(
        and(
          eq(entityTopThoughts.userId, params.userId),
          inArray(entityTopThoughts.entityId, matchedEntityIds),
        ),
      )

    const entityDistanceById = new Map(entityMatches.map((m) => [m.id, m.distance]))

    for (const row of entityTops) {
      const dist = entityDistanceById.get(row.entityId) ?? 1
      for (const thoughtId of row.thoughtIds.slice(0, 5)) {
        addCandidate(thoughtId, 'entity_top', { entityDistance: dist })
      }
    }
  }

  const vectorSeedIds = vectorRows.slice(0, 10).map((r) => r.id)
  if (vectorSeedIds.length > 0) {
    const neighbors = await db
      .select({
        thoughtId: thoughtNeighbor.thoughtId,
        neighborId: thoughtNeighbor.neighborId,
        weight: thoughtNeighbor.weight,
      })
      .from(thoughtNeighbor)
      .where(
        and(
          eq(thoughtNeighbor.userId, params.userId),
          inArray(thoughtNeighbor.thoughtId, vectorSeedIds),
        ),
      )
      // Deterministic, weight-ordered expansion: strongest neighbors first, stable tie-break.
      .orderBy(desc(thoughtNeighbor.weight), asc(thoughtNeighbor.neighborId))
      .limit(vectorSeedIds.length * NEIGHBOR_PER_SEED * 2)

    const neighborCountBySeed = new Map<string, number>()
    for (const n of neighbors) {
      const count = neighborCountBySeed.get(n.thoughtId) ?? 0
      if (count >= NEIGHBOR_PER_SEED) continue
      neighborCountBySeed.set(n.thoughtId, count + 1)
      addCandidate(n.neighborId, 'neighbor')
    }
  }

  const candidateList = prioritizeMergeCandidates(candidates)
  const candidateIds = candidateList.map((c) => c.id)
  if (candidateIds.length === 0) {
    logRetrievalPhaseTiming({
      userId: params.userId,
      query: params.query,
      mode: 'full',
      topK: limit,
      timing: timer.finish(),
      tag: '[retrieval.retrieveEvidence]',
    })
    return []
  }

  timer.mark('hydrate')
  const rows = await db
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      rerankSnippet: thought.rerankSnippet,
      category: thought.category,
      memoryType: thought.memoryType,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      createdAt: thought.createdAt,
      salienceScore: thought.salienceScore,
      entityCentralityMax: thought.entityCentralityMax,
      specificityScore: thought.specificityScore,
      recencyBucket: thought.recencyBucket,
      primaryCommunityIds: thought.primaryCommunityIds,
      author: thought.author,
      authorLabel: thought.authorLabel,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, params.userId),
        activeThoughtLifecycleCondition(),
        inArray(thought.id, candidateIds),
      ),
    )

  const rowById = new Map(rows.map((r) => [r.id, r]))

  timer.mark('fuse')
  const communityCounts = countCandidatesPerCommunity(rows)
  const scored = candidateList
    .map((c) => {
      const row = rowById.get(c.id)
      if (!row) return null

      const direct = directRelevanceMultiplier(c)
      const thoughtSim = computeThoughtSimilarity(c)
      const communitySim =
        c.communityDistance !== undefined
          ? cosineSimilarityFromDistance(c.communityDistance) * direct
          : 0
      const entitySim =
        c.entityDistance !== undefined ? cosineSimilarityFromDistance(c.entityDistance) * direct : 0

      const temporalBoost = temporalEnabled && c.sources.has('temporal') ? TEMPORAL_BOOST : 0

      const score =
        SCORE_WEIGHTS.thoughtSim * thoughtSim +
        SCORE_WEIGHTS.communitySim * communitySim +
        SCORE_WEIGHTS.entitySim * entitySim +
        SCORE_WEIGHTS.centrality * (row.entityCentralityMax ?? 0) * direct +
        SCORE_WEIGHTS.specificity * (row.specificityScore ?? 0) * direct +
        SCORE_WEIGHTS.salience * Math.min((row.salienceScore ?? 1) / SALIENCE_MAX, 1) * direct +
        SCORE_WEIGHTS.recency * (row.recencyBucket ?? 0) * direct -
        redundancyPenalty(c, row, communityCounts) +
        temporalBoost

      return {
        candidate: c,
        row,
        score,
        vectorScore: thoughtSim,
        graphScore: entitySim + (row.entityCentralityMax ?? 0) * 0.5,
      }
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)

  const rerankPool = buildRerankPool(scored)

  timer.mark('decrypt')
  const decrypted = await Promise.all(
    rerankPool.map(async ({ row, score, vectorScore, graphScore, candidate }) => {
      const [normalizedText, metadataJson] = await Promise.all([
        row.normalizedTextEncrypted
          ? decryptTenantValue({
              userId: params.userId,
              table: 'thought',
              column: 'normalized_text',
              ciphertext: row.normalizedTextEncrypted,
            })
          : Promise.resolve(row.normalizedText),
        row.metadataEncrypted
          ? decryptTenantValue({
              userId: params.userId,
              table: 'thought',
              column: 'metadata',
              ciphertext: row.metadataEncrypted,
            })
          : Promise.resolve(JSON.stringify(row.metadata ?? {})),
      ])

      const provenance = candidate.sources.has('community_bundle')
        ? 'community_bundle'
        : candidate.sources.has('entity_top')
          ? 'entity_expansion'
          : candidate.sources.has('neighbor')
            ? 'thought_neighbor'
            : candidate.sources.has('temporal')
              ? 'temporal'
              : undefined

      return {
        id: row.id,
        normalizedText,
        category: row.category,
        memoryType: row.memoryType,
        author: row.author,
        authorLabel: row.authorLabel,
        score,
        vectorScore,
        graphScore,
        metadata: {
          ...(JSON.parse(metadataJson) as Record<string, unknown>),
          ...(provenance ? { graphProvenance: provenance } : {}),
        },
        createdAt: row.createdAt,
        rerankSnippet: row.rerankSnippet ?? normalizedText.slice(0, 300),
      }
    }),
  )

  const rerankInput: Array<
    RerankCandidate & {
      createdAt: Date
      category: string
      memoryType: string | null
      metadata: Record<string, unknown>
      vectorScore: number
      graphScore: number
    }
  > = decrypted.map((d) => ({
    id: d.id,
    normalizedText: d.rerankSnippet,
    score: d.score,
    createdAt: d.createdAt,
    category: d.category,
    memoryType: d.memoryType,
    metadata: d.metadata,
    vectorScore: d.vectorScore,
    graphScore: d.graphScore,
  }))

  const reranked = shouldSkipRerank(rerankInput)
    ? rerankInput
    : await rerankCandidates(params.userId, params.query, rerankInput, undefined, limit)
  const decryptedById = new Map(decrypted.map((d) => [d.id, d]))
  const final = reranked.slice(0, limit).map((r) => {
    const d = decryptedById.get(r.id)
    return {
      id: r.id,
      normalizedText: d?.normalizedText ?? r.normalizedText,
      category: r.category as string,
      memoryType: r.memoryType as string | null,
      author: d?.author ?? 'user',
      authorLabel: d?.authorLabel ?? null,
      score: r.score,
      vectorScore: r.vectorScore as number,
      graphScore: r.graphScore as number,
      metadata: r.metadata as Record<string, unknown>,
      createdAt: r.createdAt as Date,
    }
  })

  void bumpAccessAsync(
    params.userId,
    final.map((r) => r.id),
  )

  logRetrievalPhaseTiming({
    userId: params.userId,
    query: params.query,
    mode: 'full',
    topK: limit,
    timing: timer.finish(),
    tag: '[retrieval.retrieveEvidence]',
  })

  return authorFilter ? final.filter((r) => r.author === authorFilter) : final
}
