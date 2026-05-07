import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractRelations } from './relation-extraction';

const { llmChatCompletionMock, searchThoughtsMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn(),
	searchThoughtsMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

describe('extractRelations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns parsed allowed relations', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify([{ targetId: 't2', relationType: 'related_to' }])
					}
				}
			]
		});

		const out = await extractRelations({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'source thought'
		});

		expect(out).toEqual([{ targetId: 't2', relationType: 'related_to' }]);
	});

	it('filters invalid relation types', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify([{ targetId: 't2', relationType: 'unsupported' }])
					}
				}
			]
		});

		const out = await extractRelations({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'source thought'
		});

		expect(out).toEqual([]);
	});

	it('returns empty when only self is retrieved', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't1', normalizedText: 'source thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		const out = await extractRelations({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'source thought'
		});
		expect(out).toEqual([]);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('throws when llm response has no choices', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({});
		await expect(
			extractRelations({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'source thought'
			})
		).rejects.toThrow(/no choices/);
	});

	it('throws when llm output is not a json array', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: '{}' } }]
		});
		await expect(
			extractRelations({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'source thought'
			})
		).rejects.toThrow(/JSON array/);
	});

	it('throws when llm response message is missing', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({ choices: [{}] });
		await expect(
			extractRelations({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'source thought'
			})
		).rejects.toThrow(/no message/);
	});

	it('throws when llm response is not an object', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue(null);
		await expect(
			extractRelations({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'source thought'
			})
		).rejects.toThrow(/not an object/);
	});

	it('throws when llm response content is non-string', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: 123 } }] });
		await expect(
			extractRelations({
				userId: 'u1',
				thoughtId: 't1',
				normalizedText: 'source thought'
			})
		).rejects.toThrow(/must be a string/);
	});

	it('filters non-object and malformed array entries', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'thought', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify([
							'bad',
							{ targetId: 123, relationType: 'related_to' },
							{ targetId: 't2', relationType: 999 }
						])
					}
				}
			]
		});
		const out = await extractRelations({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'source thought'
		});
		expect(out).toEqual([]);
	});
});
