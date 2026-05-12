/**
 * Retrieval routing and context selection weights (AC-009..012).
 *
 * `selectRetrievalModeFromQuery` and `CONTEXT_WEIGHTS.relation_centric` support **deferred**
 * AC-011/013 (relation-centric routing). They are **not** wired into `searchThoughts`, MCP
 * `search_thoughts`, or HTTP retrieval until that scope is explicitly re-opened; production
 * paths always use `CONTEXT_WEIGHTS.default` unless a caller passes explicit `weights`
 * (e.g. `composeAnswer` input).
 */

export type RetrievalMode = 'default' | 'relation_centric';

export const CONTEXT_WEIGHTS: Record<
	RetrievalMode,
	{ vector: number; graph: number }
> = {
	default: { vector: 0.7, graph: 0.3 },
	relation_centric: { vector: 0.4, graph: 0.6 }
};

export type ScoredCandidate = {
	id: string;
	vectorScore: number;
	graphScore: number;
};

export function combinedScore(candidate: ScoredCandidate, mode: RetrievalMode): number {
	const w = CONTEXT_WEIGHTS[mode];
	return w.vector * candidate.vectorScore + w.graph * candidate.graphScore;
}

export function rankCandidates(candidates: ScoredCandidate[], mode: RetrievalMode): ScoredCandidate[] {
	return [...candidates].sort((a, b) => combinedScore(b, mode) - combinedScore(a, mode));
}

export function selectRetrievalModeFromQuery(query: string): RetrievalMode {
	const q = query.toLowerCase();
	const relationHints =
		/\b(who|related|connection|between|graph|depends|blocked by|parent of|child of)\b/.test(q) ||
		q.includes('relationship');
	return relationHints ? 'relation_centric' : 'default';
}
