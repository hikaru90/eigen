/**
 * Hybrid retrieval entrypoint — delegates to unified `retrieveEvidence`.
 *
 * Legacy `searchThoughts` signature preserved for callers; `mode` and `weights`
 * are accepted for API compatibility but the unified precomputed path is always used.
 */

import { retrieveEvidence } from '$lib/server/retrieval/retrieve-evidence';

import type { MemoryAuthor } from '$lib/server/db/schema';

export type RetrievalResult = {
	id: string;
	normalizedText: string;
	category: string;
	memoryType: string | null;
	author: MemoryAuthor;
	authorLabel: string | null;
	score: number;
	vectorScore: number;
	graphScore: number;
	metadata: Record<string, unknown>;
	createdAt: Date;
};

export type RetrievalMode = 'fast' | 'full';

/**
 * @deprecated Use `retrieveEvidence` directly. Thin wrapper for backward compatibility.
 */
export async function searchThoughts(params: {
	userId: string;
	query: string;
	topK?: number;
	weights?: { vector: number; graph: number };
	mode?: RetrievalMode;
	queryEmbedding?: number[];
	temporalIntent?: import('$lib/server/retrieval/temporal').TemporalQueryIntent | null;
	authorFilter?: MemoryAuthor;
}): Promise<RetrievalResult[]> {
	return retrieveEvidence({
		userId: params.userId,
		query: params.query,
		topK: params.topK,
		queryEmbedding: params.queryEmbedding,
		temporalIntent: params.temporalIntent,
		authorFilter: params.authorFilter
	});
}

export { retrieveEvidence } from '$lib/server/retrieval/retrieve-evidence';
