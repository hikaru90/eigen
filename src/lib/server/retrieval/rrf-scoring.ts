/** Max weighted-merge score (`retrieveEvidence` SCORE_WEIGHTS sum to 1.0). */
export type RetrievalFusionWeights = { vector: number; graph: number }

/**
 * Upper bound of the `retrieveEvidence` weighted-merge score excluding the flat temporal
 * boost (SCORE_WEIGHTS sum to 1.0; temporal-intent hits can exceed this by up to +0.18).
 * `normalizeRetrievalScore` intentionally clamps to [0, 1] for MCP `threshold` filtering.
 */
export const MAX_RETRIEVAL_MERGE_SCORE = 1

/** Minimum normalized score for a thought to enter Q&A context. */
export const COMPOSE_ANSWER_RELEVANCE_MIN = 0.22

/** Maps weighted-merge scores to [0, 1] for MCP `threshold` filtering (clamps above max). */
export function normalizeRetrievalScore(score: number): number {
  if (MAX_RETRIEVAL_MERGE_SCORE <= 0) return 0
  return Math.min(1, Math.max(0, score / MAX_RETRIEVAL_MERGE_SCORE))
}

/** The highest score that is still under `floor` (the candidate that just missed it), or null. */
export function bestScoreBelowFloor(scores: readonly number[], floor: number): number | null {
  let best: number | null = null
  for (const score of scores) {
    if (score < floor && (best === null || score > best)) best = score
  }
  return best
}

/** Map raw FTS rank to a thought-similarity scale comparable with vector cosine sim. */
export function normalizeLexicalRank(raw: number): number {
  if (raw <= 0) return 0
  return Math.min(1, raw * 2.5)
}

/** Standard reciprocal-rank-fusion damping constant. */
export const RRF_K = 60

/**
 * Reciprocal-rank fusion over ranked id lists: each id scores the sum of 1/(RRF_K + rank) over
 * the lists that contain it (rank is 1-based). Returns deduplicated ids, best first; ties keep
 * first appearance (earlier list, earlier rank), so the result is deterministic.
 */
export function reciprocalRankFusion(lists: ReadonlyArray<readonly string[]>): string[] {
  const score = new Map<string, number>()
  for (const list of lists) {
    const seenInList = new Set<string>()
    let rank = 0
    for (const id of list) {
      if (seenInList.has(id)) continue
      seenInList.add(id)
      rank += 1
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + rank))
    }
  }
  // Map iteration order is insertion order, and Array.sort is stable: ties keep first appearance.
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/** `reciprocalRankFusion` over lists of hits; keeps the first-seen hit object per id. */
export function fuseRankedHits<T extends { id: string }>(
  lists: ReadonlyArray<readonly T[]>,
  limit: number,
): T[] {
  const byId = new Map<string, T>()
  for (const list of lists) {
    for (const hit of list) if (!byId.has(hit.id)) byId.set(hit.id, hit)
  }
  return reciprocalRankFusion(lists.map((list) => list.map((hit) => hit.id)))
    .slice(0, limit)
    .map((id) => byId.get(id)!)
}
