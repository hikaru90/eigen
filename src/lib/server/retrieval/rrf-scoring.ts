/** Reciprocal rank fusion constant — must match `searchThoughts`. */
export const RRF_K = 60;

export type RetrievalFusionWeights = { vector: number; graph: number };

/**
 * Upper bound on fused RRF score when a thought ranks #1 on vector, lexical, and graph.
 * Vector and lexical each contribute `weights.vector / (RRF_K + 1)`; graph adds `weights.graph / (RRF_K + 1)`.
 */
export function maxFusedRrfScore(weights: RetrievalFusionWeights): number {
	const perChannel = 1 / (RRF_K + 1);
	return (2 * weights.vector + weights.graph) * perChannel;
}

/** Maps raw fused RRF scores to [0, 1] for MCP `threshold` filtering. */
export function normalizeFusedRrfScore(score: number, weights: RetrievalFusionWeights): number {
	const max = maxFusedRrfScore(weights);
	if (max <= 0) return 0;
	return Math.min(1, score / max);
}
