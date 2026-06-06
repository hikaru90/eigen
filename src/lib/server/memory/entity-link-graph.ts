/**
 * Graph-first entity link scoring (pure + small helpers).
 *
 * Used during ingest resolution to prefer structurally consistent merges over
 * embedding-neighbor merges.
 */

export type GraphLinkCandidate = {
	id: string;
	canonicalKey: string;
	label: string;
	entityType: string;
	graphScore: number;
};

/** Minimum score required to auto-merge on graph evidence alone. */
export const MIN_GRAPH_MERGE_SCORE = 5;

/** Top candidate must beat runner-up by at least this margin. */
export const GRAPH_WINNER_MARGIN = 2;

export type GraphMergePick =
	| { kind: 'winner'; candidate: GraphLinkCandidate }
	| { kind: 'ambiguous'; topScore: number; runnerUpScore: number }
	| { kind: 'none' };

export function buildEntityAdjacency(
	edges: Array<{ sourceId: string; targetId: string }>
): Map<string, Set<string>> {
	const adj = new Map<string, Set<string>>();
	const link = (a: string, b: string) => {
		if (a === b) return;
		if (!adj.has(a)) adj.set(a, new Set());
		if (!adj.has(b)) adj.set(b, new Set());
		adj.get(a)!.add(b);
		adj.get(b)!.add(a);
	};
	for (const edge of edges) {
		link(edge.sourceId, edge.targetId);
	}
	return adj;
}

export function neighborEntityIds(
	adjacency: Map<string, Set<string>>,
	seedIds: Iterable<string>
): Set<string> {
	const neighbors = new Set<string>();
	for (const seedId of seedIds) {
		for (const nbr of adjacency.get(seedId) ?? []) {
			neighbors.add(nbr);
		}
	}
	return neighbors;
}

/**
 * Exact lexical key match only. XXX REMOVED — substring nickname merge heuristic.
 * Entity merge beyond exact match uses embedding similarity in entity-resolution.
 */
export function hasLexicalMergeEvidence(mentionKey: string, candidateCanonicalKey: string): boolean {
	return Boolean(mentionKey && candidateCanonicalKey && mentionKey === candidateCanonicalKey);
}

export function scoreGraphLinkCandidate(input: {
	candidateId: string;
	candidateEntityType: string;
	candidateCanonicalKey: string;
	mentionEntityType: string;
	mentionKey: string;
	coMentionEntityIds: Set<string>;
	neighborEntityIds: Set<string>;
}): number {
	let score = 0;
	if (input.candidateEntityType === input.mentionEntityType) {
		score += 2;
	}
	if (input.neighborEntityIds.has(input.candidateId)) {
		score += 5;
	}
	// Same-thought co-mention context: candidate already linked to another mention in this thought.
	for (const coId of input.coMentionEntityIds) {
		if (coId === input.candidateId) continue;
		if (input.neighborEntityIds.has(coId) && input.neighborEntityIds.has(input.candidateId)) {
			score += 3;
			break;
		}
	}
	if (input.mentionKey === input.candidateCanonicalKey) {
		score += 2;
	}
	return score;
}

export function pickGraphMergeWinner(candidates: GraphLinkCandidate[]): GraphMergePick {
	const ranked = [...candidates].sort((a, b) => b.graphScore - a.graphScore);
	const top = ranked[0];
	if (!top || top.graphScore < MIN_GRAPH_MERGE_SCORE) {
		return { kind: 'none' };
	}
	const runnerUp = ranked[1];
	if (runnerUp && top.graphScore - runnerUp.graphScore < GRAPH_WINNER_MARGIN) {
		return {
			kind: 'ambiguous',
			topScore: top.graphScore,
			runnerUpScore: runnerUp.graphScore
		};
	}
	return { kind: 'winner', candidate: top };
}
