import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRelevantCommunitySummaries, hasCommunitySummaries, searchGlobal } from './global';

const { getDbMock, createThoughtEmbeddingMock, llmChatCompletionMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	createThoughtEmbeddingMock: vi.fn(),
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));
vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

describe('hasCommunitySummaries', () => {
	it('returns false when no summaries exist', async () => {
		const limit = vi.fn(async () => []);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		await expect(hasCommunitySummaries('u1')).resolves.toBe(false);
	});

	it('returns true when at least one summary exists', async () => {
		const limit = vi.fn(async () => [{ id: 'cs1' }]);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		await expect(hasCommunitySummaries('u1')).resolves.toBe(true);
	});
});

function mockCommunityDb(rows: unknown[]) {
	const limit = vi.fn(async () => rows);
	const orderBy = vi.fn(() => ({ limit }));
	const where = vi.fn(() => ({ orderBy }));
	const from = vi.fn(() => ({ where }));
	getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });
	return limit;
}

describe('fetchRelevantCommunitySummaries', () => {
	it('returns ordered summaries from the vector search without calling the LLM', async () => {
		mockCommunityDb([
			{ communityId: 'c1', level: 0, summaryText: 'Theme one', distance: 0.1 },
			{ communityId: 'c2', level: 1, summaryText: 'Theme two', distance: 0.2 }
		]);

		const out = await fetchRelevantCommunitySummaries({
			userId: 'u1',
			queryEmbedding: [0.1, 0.2, 0.3],
			limit: 5
		});

		expect(out).toEqual([
			{ communityId: 'c1', level: 0, summaryText: 'Theme one' },
			{ communityId: 'c2', level: 1, summaryText: 'Theme two' }
		]);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it.each([
		{ input: undefined, expected: 6 },
		{ input: 0, expected: 1 },
		{ input: -3, expected: 1 },
		{ input: 100, expected: 20 }
	])('clamps limit $input to $expected', async ({ input, expected }) => {
		const limit = mockCommunityDb([]);

		await fetchRelevantCommunitySummaries({
			userId: 'u1',
			queryEmbedding: [0.1, 0.2],
			limit: input
		});

		expect(limit).toHaveBeenCalledWith(expected);
	});
});

describe('searchGlobal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
	});

	it('returns a helpful empty answer when no community summaries exist', async () => {
		mockCommunityDb([]);

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/don't have enough memory clusters/i);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('maps community summaries and reduces partial answers', async () => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'User thinks about baking experiments.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Baking is a recurring theme.","score":85}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: 'You often explore baking ideas across memories.' } }]
			});

		const result = await searchGlobal({ userId: 'u1', query: 'What do I think about often?' });

		expect(result.communitiesUsed).toBe(1);
		expect(result.answer).toMatch(/baking/i);
		expect(result.sources[0]?.communityId).toBe('c1');
	});

	it('selects preferred level when enough candidates match preferLevel', async () => {
		mockCommunityDb([
			{ id: 'cs1', communityId: 'c1', level: 1, summaryText: 'Theme A', distance: 0.1 },
			{ id: 'cs2', communityId: 'c2', level: 1, summaryText: 'Theme B', distance: 0.2 },
			{ id: 'cs3', communityId: 'c3', level: 1, summaryText: 'Theme C', distance: 0.3 },
			{ id: 'cs4', communityId: 'c4', level: 0, summaryText: 'Root theme', distance: 0.05 }
		]);

		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"A pattern.","score":80}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Another pattern.","score":70}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Third pattern.","score":60}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: 'Synthesised global answer.' } }]
			});

		await searchGlobal({
			userId: 'u1',
			query: 'What themes recur?',
			topCommunities: 5,
			preferLevel: 1
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(4);
	});

	it('falls back to all candidates when preferred level is sparse', async () => {
		mockCommunityDb([
			{ id: 'cs1', communityId: 'c1', level: 2, summaryText: 'Leaf only', distance: 0.1 },
			{ id: 'cs2', communityId: 'c2', level: 1, summaryText: 'Theme one', distance: 0.2 },
			{ id: 'cs3', communityId: 'c3', level: 1, summaryText: 'Theme two', distance: 0.3 }
		]);

		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Leaf insight.","score":90}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Theme insight.","score":80}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"More theme insight.","score":70}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: { content: 'Combined answer.' } }]
			});

		await searchGlobal({
			userId: 'u1',
			query: 'What themes recur?',
			topCommunities: 3,
			preferLevel: 2
		});

		expect(llmChatCompletionMock).toHaveBeenCalledTimes(4);
	});

	it.each([
		{ label: 'missing choices', response: {} },
		{ label: 'empty choices', response: { choices: [] } },
		{ label: 'non-string content', response: { choices: [{ message: { content: 42 } }] } }
	])('skips map step when LLM returns $label', async ({ response }) => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Some summary.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock.mockResolvedValueOnce(response);

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/couldn't find relevant memory patterns/i);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
	});

	it('skips map step when LLM content is not valid JSON', async () => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Some summary.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock.mockResolvedValueOnce({
			choices: [{ message: { content: 'not json at all' } }]
		});

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/couldn't find relevant memory patterns/i);
	});

	it('continues map step when LLM throws', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Failing summary.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock.mockRejectedValueOnce(new Error('map LLM down'));

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/couldn't find relevant memory patterns/i);
		expect(warnSpy).toHaveBeenCalledWith(
			'[searchGlobal] map step failed for community',
			expect.objectContaining({ communityId: 'c1', message: 'map LLM down' })
		);

		warnSpy.mockRestore();
	});

	it('returns empty-pattern answer when all partial answers are filtered out', async () => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Irrelevant cluster.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock.mockResolvedValueOnce({
			choices: [{ message: { content: '{"answer":"Not relevant","score":50}' } }]
		});

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/couldn't find relevant memory patterns/i);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(1);
	});

	it('falls back to top partial answer when reduce LLM returns invalid choices', async () => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Baking cluster.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Baking is a recurring theme.","score":85}' } }]
			})
			.mockResolvedValueOnce({ choices: [] });

		const result = await searchGlobal({ userId: 'u1', query: 'What do I think about often?' });

		expect(result.answer).toBe('Baking is a recurring theme.');
		expect(result.communitiesUsed).toBe(1);
	});

	it('ignores map responses with non-numeric scores or non-string answers', async () => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Some summary.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock.mockResolvedValueOnce({
			choices: [{ message: { content: '{"answer":42,"score":"high"}' } }]
		});

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/couldn't find relevant memory patterns/i);
	});

	it('stringifies non-Error map failures in warning logs', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Failing summary.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock.mockRejectedValueOnce('map LLM down');

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(warnSpy).toHaveBeenCalledWith(
			'[searchGlobal] map step failed for community',
			expect.objectContaining({ message: 'map LLM down' })
		);
		warnSpy.mockRestore();
	});

	it('uses an empty reduce answer when reduce content is missing', async () => {
		mockCommunityDb([
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'Baking cluster.',
				distance: 0.1
			}
		]);

		llmChatCompletionMock
			.mockResolvedValueOnce({
				choices: [{ message: { content: '{"answer":"Baking is a recurring theme.","score":85}' } }]
			})
			.mockResolvedValueOnce({
				choices: [{ message: {} }]
			});

		const result = await searchGlobal({ userId: 'u1', query: 'What do I think about often?' });

		expect(result.answer).toBe('');
		expect(result.communitiesUsed).toBe(1);
	});
});
