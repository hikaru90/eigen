/** @deprecated Legacy RRF constant; production retrieval uses weighted merge in `retrieveEvidence`. */
export const RRF_K = 60;

export type RetrievalFusionWeights = { vector: number; graph: number };

/** Max weighted-merge score (`retrieveEvidence` SCORE_WEIGHTS sum to 1.0). */
export const MAX_RETRIEVAL_MERGE_SCORE = 1;

/** Maps weighted-merge scores to [0, 1] for MCP `threshold` filtering. */
export function normalizeRetrievalScore(score: number): number {
	if (MAX_RETRIEVAL_MERGE_SCORE <= 0) return 0;
	return Math.min(1, Math.max(0, score / MAX_RETRIEVAL_MERGE_SCORE));
}

/**
 * @deprecated Legacy RRF upper bound; use {@link normalizeRetrievalScore} for production retrieval.
 */
export function maxFusedRrfScore(weights: RetrievalFusionWeights): number {
	const perChannel = 1 / (RRF_K + 1);
	return (2 * weights.vector + weights.graph) * perChannel;
}

/**
 * @deprecated Legacy RRF normalization; use {@link normalizeRetrievalScore} for production retrieval.
 */
export function normalizeFusedRrfScore(score: number, weights: RetrievalFusionWeights): number {
	const max = maxFusedRrfScore(weights);
	if (max <= 0) return 0;
	return Math.min(1, score / max);
}
