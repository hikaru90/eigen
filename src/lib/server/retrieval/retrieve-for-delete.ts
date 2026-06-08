/**
 * Multi-query semantic retrieval for delete flows.
 */

import { deriveDeleteSearchQueries } from '$lib/server/retrieval/derive-delete-search-query';
import { searchThoughts, type RetrievalResult } from '$lib/server/retrieval/service';

const TOP_K_PER_QUERY = 20;

export function mergeRetrievalResultsByBestScore(
	resultSets: RetrievalResult[][]
): RetrievalResult[] {
	const byId = new Map<string, RetrievalResult>();
	for (const hits of resultSets) {
		for (const hit of hits) {
			const existing = byId.get(hit.id);
			if (!existing || hit.score > existing.score) {
				byId.set(hit.id, hit);
			}
		}
	}
	return [...byId.values()].sort((a, b) => b.score - a.score);
}

export async function retrieveThoughtRowsForDeleteRequest(params: {
	userId: string;
	deleteRequest: string;
}): Promise<{ queries: string[]; results: RetrievalResult[] }> {
	const queries = await deriveDeleteSearchQueries({
		userId: params.userId,
		deleteRequest: params.deleteRequest
	});

	const resultSets = await Promise.all(
		queries.map((query) =>
			searchThoughts({
				userId: params.userId,
				query,
				topK: TOP_K_PER_QUERY
			})
		)
	);

	return {
		queries,
		results: mergeRetrievalResultsByBestScore(resultSets)
	};
}
