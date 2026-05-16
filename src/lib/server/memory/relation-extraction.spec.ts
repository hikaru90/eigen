import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractRelations } from './relation-extraction';

const { llmChatCompletionMock, searchThoughtsMock, getDbMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn(),
	searchThoughtsMock: vi.fn(),
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

vi.mock('$lib/server/retrieval/service', () => ({
	searchThoughts: searchThoughtsMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

/** Returns an empty temporal neighbor chain by default. */
function makeEmptyDbMock() {
	return {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					orderBy: vi.fn(() => ({
						limit: vi.fn(async () => [])
					}))
				}))
			}))
		}))
	};
}

describe('extractRelations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue(makeEmptyDbMock());
	});

	it('returns parsed allowed relations', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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

	it('accepts all specific relation types without coercing to related_to', async () => {
		const types = ['follows_from', 'continuation_of', 'caused_by', 'refines', 'contradicts', 'mentions', 'depends_on'] as const;
		for (const relationType of types) {
			searchThoughtsMock.mockResolvedValue([
				{ id: 't2', normalizedText: 'prior thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
			]);
			llmChatCompletionMock.mockResolvedValue({
				choices: [{ message: { content: JSON.stringify([{ targetId: 't2', relationType }]) } }]
			});
			const out = await extractRelations({ userId: 'u1', thoughtId: 't1', normalizedText: 'next thought' });
			expect(out).toEqual([{ targetId: 't2', relationType }]);
		}
	});

	it('prompt instructs model to use most specific type and treats related_to as last resort', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'prior thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: JSON.stringify([]) } }]
		});
		await extractRelations({ userId: 'u1', thoughtId: 't1', normalizedText: 'source' });

		const userPrompt = llmChatCompletionMock.mock.calls[0][0].messages[1].content as string;
		const systemPrompt = llmChatCompletionMock.mock.calls[0][0].messages[0].content as string;

		// Must NOT contain any of the old biasing instructions
		expect(userPrompt).not.toContain('use this liberally');
		expect(userPrompt).not.toContain('topical similarity is enough for related_to');
		expect(userPrompt).not.toContain('Use related_to for any two thoughts');
		expect(systemPrompt).not.toContain('prefer related_to over returning an empty array');

		// Must instruct the model to prefer specific types
		expect(userPrompt).toMatch(/most specific/i);
		// "last resort" framing lives in the system message
		expect(systemPrompt).toMatch(/last resort/i);

		// Must include few-shot examples covering specific types
		expect(userPrompt).toContain('refines');
		expect(userPrompt).toContain('mentions');
		expect(userPrompt).toContain('contradicts');
		expect(userPrompt).toContain('follows_from');
	});

	it('handles mixed response with specific and generic types correctly', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'thought two', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} },
			{ id: 't3', normalizedText: 'thought three', category: 'idea', score: 0.9, vectorScore: 0.9, graphScore: 0, metadata: {} }
		]);
		llmChatCompletionMock.mockResolvedValue({
			choices: [{
				message: {
					content: JSON.stringify([
						{ targetId: 't2', relationType: 'contradicts' },
						{ targetId: 't3', relationType: 'related_to' }
					])
				}
			}]
		});
		const out = await extractRelations({ userId: 'u1', thoughtId: 't1', normalizedText: 'source' });
		expect(out).toEqual([
			{ targetId: 't2', relationType: 'contradicts' },
			{ targetId: 't3', relationType: 'related_to' }
		]);
	});

	it('filters invalid relation types', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
			{ id: 't1', normalizedText: 'source thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		const out = await extractRelations({
			userId: 'u1',
			thoughtId: 't1',
			normalizedText: 'source thought'
		});
		expect(out).toEqual([]);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('merges temporal neighbors with semantic neighbors', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'semantic neighbor', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
		]);
		// Temporal neighbor (distinct from semantic)
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => ({
						orderBy: vi.fn(() => ({
							limit: vi.fn(async () => [
								{ id: 't3', normalizedText: 'temporal neighbor' },
								{ id: 't1', normalizedText: 'self — should be filtered' }
							])
						}))
					}))
				}))
			}))
		});
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: JSON.stringify([{ targetId: 't3', relationType: 'follows_from' }]) } }]
		});
		const out = await extractRelations({ userId: 'u1', thoughtId: 't1', normalizedText: 'source' });
		// LLM prompt should have included t3 as a candidate
		const prompt = llmChatCompletionMock.mock.calls[0][0].messages[1].content as string;
		expect(prompt).toContain('t3');
		expect(out).toEqual([{ targetId: 't3', relationType: 'follows_from' }]);
	});

	it('throws when llm response has no choices', async () => {
		searchThoughtsMock.mockResolvedValue([
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
			{ id: 't2', normalizedText: 'connected thought', category: 'task', score: 1, vectorScore: 1, graphScore: 0, metadata: {} }
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
