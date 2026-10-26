/**
 * Candidates for one expansion sub-query (personalization retrieval): the normal hybrid
 * thought channels — vector ANN + lexical FTS — fused by reciprocal rank within the sub-query.
 * Embeddings stay in the database; only ids and scores leave.
 */

import type { MemoryAuthor } from '$lib/server/db/schema'
import { lexicalSearch } from '$lib/server/retrieval/lexical'
import { reciprocalRankFusion } from '$lib/server/retrieval/rrf-scoring'
import { fetchThoughtAnn, THOUGHT_ANN_LIMIT } from '$lib/server/retrieval/thought-ann'

/** Max candidates one sub-query contributes to the merge. */
export const EXPANSION_CANDIDATES_PER_QUERY = 15

export type ExpansionCandidate = {
  id: string
  /** Cosine distance when surfaced by vector ANN. */
  vectorDistance?: number
  /** Postgres `ts_rank_cd` when surfaced by lexical FTS. */
  lexicalScore?: number
}

/** Hybrid candidates for one sub-query, best first (RRF of its vector and lexical rankings). */
export async function fetchExpansionCandidates(params: {
  userId: string
  query: string
  queryEmbedding: number[]
  authorFilter?: MemoryAuthor
}): Promise<ExpansionCandidate[]> {
  const [vectorRows, lexicalRows] = await Promise.all([
    fetchThoughtAnn({
      userId: params.userId,
      queryEmbedding: params.queryEmbedding,
      authorFilter: params.authorFilter,
    }),
    lexicalSearch({
      userId: params.userId,
      query: params.query,
      limit: THOUGHT_ANN_LIMIT,
      authorFilter: params.authorFilter,
    }),
  ])
  const byId = new Map<string, ExpansionCandidate>()
  for (const row of vectorRows) byId.set(row.id, { id: row.id, vectorDistance: row.distance })
  for (const row of lexicalRows) {
    byId.set(row.id, { ...(byId.get(row.id) ?? { id: row.id }), lexicalScore: row.lexicalScore })
  }
  const ranked = reciprocalRankFusion([
    vectorRows.map((r) => r.id),
    [...lexicalRows].sort((a, b) => b.lexicalScore - a.lexicalScore).map((r) => r.id),
  ])
  return ranked.slice(0, EXPANSION_CANDIDATES_PER_QUERY).map((id) => byId.get(id)!)
}
