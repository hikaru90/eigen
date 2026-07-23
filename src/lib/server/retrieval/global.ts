/**
 * Community-theme retrieval for compose.
 *
 * `fetchRelevantCommunitySummaries` returns the L1 community summaries closest to the
 * query embedding (HNSW cosine) — cheap, non-authoritative theme hints used by
 * `composeAnswer` for global-scope questions (AC-026). The authoritative evidence path
 * is `retrieveEvidence` (thought rows); summaries never answer questions directly.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { communitySummary } from '$lib/server/db/schema'
import { COMMUNITY_MID_LEVEL } from '$lib/server/consolidation/community-levels'

export type RelevantCommunitySummary = {
  communityId: string
  level: number
  summaryText: string
}

/**
 * Fetch the community summaries most relevant to a query embedding (HNSW cosine),
 * WITHOUT any LLM step. Used as cheap thematic context for blended profile/global
 * answers in `composeAnswer` (no extra embedding or LLM cost).
 */
export async function fetchRelevantCommunitySummaries(params: {
  userId: string
  queryEmbedding: number[]
  limit?: number
}): Promise<RelevantCommunitySummary[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 6, 20))
  const vectorLiteral = `[${params.queryEmbedding.join(',')}]`
  const db = getDb()
  const distanceExpr = sql<number>`${communitySummary.summaryEmbedding} <=> ${vectorLiteral}::vector`
  const rows = await db
    .select({
      communityId: communitySummary.communityId,
      level: communitySummary.level,
      summaryText: communitySummary.summaryText,
      distance: distanceExpr,
    })
    .from(communitySummary)
    .where(
      and(
        eq(communitySummary.userId, params.userId),
        eq(communitySummary.level, COMMUNITY_MID_LEVEL),
        isNotNull(communitySummary.summaryEmbedding),
      ),
    )
    .orderBy(distanceExpr)
    .limit(limit)
  return rows.map((r) => ({
    communityId: r.communityId,
    level: r.level,
    summaryText: r.summaryText,
  }))
}
