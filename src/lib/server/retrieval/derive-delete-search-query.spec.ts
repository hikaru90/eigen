import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DERIVE_DELETE_SEARCH_QUERY_PROMPT,
	deriveDeleteSearchQueries,
	parseDeleteSearchQueriesResponse
} from './derive-delete-search-query';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

describe('parseDeleteSearchQueriesResponse', () => {
	it('parses query array', () => {
		expect(
			parseDeleteSearchQueriesResponse(
				'{"queries":["recipes cooking dishes","food preparation"]}'
			)
		).toEqual(['recipes cooking dishes', 'food preparation']);
	});

	it('rejects empty queries array', () => {
		expect(() => parseDeleteSearchQueriesResponse('{"queries":[]}')).toThrow(/non-empty array/);
	});
});

describe('DERIVE_DELETE_SEARCH_QUERY_PROMPT', () => {
	it('instructs content-focused queries without delete verbs', () => {
		expect(DERIVE_DELETE_SEARCH_QUERY_PROMPT).toContain('delete all recipes');
		expect(DERIVE_DELETE_SEARCH_QUERY_PROMPT).toContain('Do NOT include words like delete');
	});
});

describe('deriveDeleteSearchQueries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns LLM-derived content queries for a bulk recipe delete', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content:
							'{"queries":["recipes cooking dishes meals","food ingredients preparation"]}'
					}
				}
			]
		});

		await expect(
			deriveDeleteSearchQueries({
				userId: 'u1',
				deleteRequest: 'delete all recipes'
			})
		).resolves.toEqual(['recipes cooking dishes meals', 'food ingredients preparation']);

		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({ logContext: 'delete_search_query' })
		);
	});
});
