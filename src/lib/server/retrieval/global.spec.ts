import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchGlobal } from './global';

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

describe('searchGlobal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);
	});

	it('returns a helpful empty answer when no community summaries exist', async () => {
		const limit = vi.fn(async () => []);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

		const result = await searchGlobal({ userId: 'u1', query: 'What themes recur?' });

		expect(result.communitiesUsed).toBe(0);
		expect(result.answer).toMatch(/don't have enough memory clusters/i);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('maps community summaries and reduces partial answers', async () => {
		const communities = [
			{
				id: 'cs1',
				communityId: 'c1',
				level: 1,
				summaryText: 'User thinks about baking experiments.',
				distance: 0.1
			}
		];
		const limit = vi.fn(async () => communities);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) });

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
});
