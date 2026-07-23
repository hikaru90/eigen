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
