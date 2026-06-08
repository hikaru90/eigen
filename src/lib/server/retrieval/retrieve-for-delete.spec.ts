import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeRetrievalResultsByBestScore } from './retrieve-for-delete';

const { deriveDeleteSearchQueriesMock, searchThoughtsMock } = vi.hoisted(() => ({
	deriveDeleteSearchQueriesMock: vi.fn(),
	searchThoughtsMock: vi.fn()
}));

vi.mock('$lib/server/retrieval/derive-delete-search-query', () => ({
	deriveDeleteSearchQueries: deriveDeleteSearchQueriesMock
}));
vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

import { retrieveThoughtRowsForDeleteRequest } from './retrieve-for-delete';

describe('mergeRetrievalResultsByBestScore', () => {
	it('keeps the highest score per thought id', () => {
		const merged = mergeRetrievalResultsByBestScore([
			[
				{
					id: 't1',
					normalizedText: 'Shakshuka',
					category: 'reference',
					memoryType: null,
					score: 0.4,
					vectorScore: 0.4,
					graphScore: 0,
					metadata: {},
					createdAt: new Date()
				}
			],
			[
				{
					id: 't1',
					normalizedText: 'Shakshuka',
					category: 'reference',
					memoryType: null,
					score: 0.9,
					vectorScore: 0.9,
					graphScore: 0,
					metadata: {},
					createdAt: new Date()
				},
				{
					id: 't2',
					normalizedText: 'Caesar salad',
					category: 'reference',
					memoryType: null,
					score: 0.8,
					vectorScore: 0.8,
					graphScore: 0,
					metadata: {},
					createdAt: new Date()
				}
			]
		]);

		expect(merged.map((r) => r.id)).toEqual(['t1', 't2']);
		expect(merged[0].score).toBe(0.9);
	});
});

describe('retrieveThoughtRowsForDeleteRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('runs semantic search for each derived query and merges results', async () => {
		deriveDeleteSearchQueriesMock.mockResolvedValue(['recipes cooking', 'shakshuka salad soup']);
		searchThoughtsMock
			.mockResolvedValueOnce([
				{
					id: 't-shak',
					normalizedText: 'Shakshuka with eggs',
					category: 'reference',
					memoryType: null,
					score: 0.7,
					vectorScore: 0.7,
					graphScore: 0,
					metadata: {},
					createdAt: new Date()
				}
			])
			.mockResolvedValueOnce([
				{
					id: 't-salad',
					normalizedText: 'Classic Caesar Salad',
					category: 'reference',
					memoryType: null,
					score: 0.75,
					vectorScore: 0.75,
					graphScore: 0,
					metadata: {},
					createdAt: new Date()
				}
			]);

		const out = await retrieveThoughtRowsForDeleteRequest({
			userId: 'u1',
			deleteRequest: 'delete all recipes'
		});

		expect(deriveDeleteSearchQueriesMock).toHaveBeenCalledWith({
			userId: 'u1',
			deleteRequest: 'delete all recipes'
		});
		expect(searchThoughtsMock).toHaveBeenCalledTimes(2);
		expect(out.queries).toEqual(['recipes cooking', 'shakshuka salad soup']);
		expect(out.results.map((r) => r.id)).toEqual(['t-salad', 't-shak']);
	});
});
