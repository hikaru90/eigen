/**
 * LLM-based listwise reranker.
 *
 * Takes the top-k candidates from RRF fusion and re-ranks them using a single
 * LLM prompt that sees both the query and all candidate excerpts together.
 * This allows the model to compare candidates against each other and apply
 * richer reasoning than cosine similarity alone.
 *
 * Context-aware: includes the user's 3 most recent captures as context
 * so the reranker can prefer currently-relevant memories over stale ones.
 *
 * Cost: 1 LLM call per search when reranking is triggered.
 * Only triggered when: topK ≤ 15 (controlled by caller).
 *
 * Returns the input candidates in reranked order.
 * If reranking fails, returns the original order (fail-safe).
 */

import { llmChatCompletion } from '$lib/server/llm/llm-client';

export type RerankCandidate = {
	id: string;
	normalizedText: string;
	score: number;
	[key: string]: unknown;
};

export type RecentContext = {
	normalizedText: string;
};

/**
 * Rerank candidates using a single listwise LLM prompt.
 *
 * @param userId - Tenant identifier (for LLM billing).
 * @param query - The original search query.
 * @param candidates - Top-k candidates from RRF fusion.
 * @param recentContext - Optional recent captures for context awareness.
 * @returns Candidates in reranked order. Returns original order on failure.
 */
export async function rerankCandidates<T extends RerankCandidate>(
	userId: string,
	query: string,
	candidates: T[],
	recentContext?: RecentContext[]
): Promise<T[]> {
	if (candidates.length <= 1) return candidates;

	const contextBlock =
		recentContext && recentContext.length > 0
			? [
					'Recent context (user\'s latest captures, for relevance calibration):',
					recentContext
						.slice(0, 3)
						.map((c, i) => `[recent-${i + 1}] ${c.normalizedText.slice(0, 150)}`)
						.join('\n')
				].join('\n')
			: '';

	const candidateBlock = candidates
		.map((c, i) => `[${i + 1}] ID:${c.id}\n${c.normalizedText.slice(0, 300)}`)
		.join('\n\n');

	const prompt = [
		`Query: ${query}`,
		'',
		contextBlock,
		contextBlock ? '' : null,
		'Candidates to rerank (most to least useful for answering the query):',
		candidateBlock,
		'',
		'Return ONLY a JSON array of IDs in order from most to least relevant.',
		'Example: ["id-3", "id-1", "id-2"]',
		'Include ALL candidate IDs. Do not omit any.'
	]
		.filter((l) => l !== null)
		.join('\n');

	try {
		const response = await llmChatCompletion({
			userId,
			messages: [
				{
					role: 'system',
					content:
						'You rerank search results by relevance. Return only a JSON array of IDs, most relevant first.'
				},
				{ role: 'user', content: prompt }
			],
			temperature: 0
		});

		const choices = (response as { choices?: unknown }).choices;
		if (!Array.isArray(choices) || choices.length === 0) return candidates;

		const content = (choices[0] as { message?: { content?: unknown } }).message?.content;
		if (typeof content !== 'string') return candidates;

		// Parse the ranked ID list.
		let rankedIds: string[];
		try {
			const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
			const parsed = JSON.parse(cleaned) as unknown;
			if (!Array.isArray(parsed)) return candidates;
			rankedIds = parsed.filter((v): v is string => typeof v === 'string');
		} catch {
			return candidates;
		}

		// Reorder candidates according to ranked IDs.
		const indexById = new Map<string, number>();
		rankedIds.forEach((id, idx) => indexById.set(id, idx));

		const reranked = [...candidates].sort((a, b) => {
			const rankA = indexById.get(a.id) ?? candidates.length;
			const rankB = indexById.get(b.id) ?? candidates.length;
			return rankA - rankB;
		});

		return reranked;
	} catch (err) {
		// Fail-safe: return original order if reranking fails.
		console.warn('[reranker] reranking failed, returning original order', {
			userId,
			message: err instanceof Error ? err.message : String(err)
		});
		return candidates;
	}
}
