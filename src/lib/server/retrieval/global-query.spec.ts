import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyRetrievalScope, parseRetrievalScopeResponse } from './global-query';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

describe('parseRetrievalScopeResponse', () => {
	it('parses scope from JSON', () => {
		expect(parseRetrievalScopeResponse('{"scope":"global"}')).toBe('global');
		expect(parseRetrievalScopeResponse('{"scope":"local"}')).toBe('local');
		expect(parseRetrievalScopeResponse('```json\n{"scope":"global"}\n```')).toBe('global');
	});

	it('rejects invalid scope', () => {
		expect(() => parseRetrievalScopeResponse('{"scope":"maybe"}')).toThrow(
			/scope must be "global" or "local"/
		);
		expect(() => parseRetrievalScopeResponse('not json')).toThrow();
	});
});

describe('classifyRetrievalScope', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns global when the LLM classifies a thematic self-profile question', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							scope: 'global',
							temporal: false,
							kind: 'none',
							comparativeOrdering: false,
							entityHints: []
						})
					}
				}
			]
		});

		await expect(
			classifyRetrievalScope({ userId: 'u1', query: 'was weißt du über mich?' })
		).resolves.toBe('global');

		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				logContext: 'query_intent_classifier'
			})
		);
	});

	it('returns local when the LLM classifies a named-entity lookup', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							scope: 'local',
							temporal: false,
							kind: 'none',
							comparativeOrdering: false,
							entityHints: ['Clemmy']
						})
					}
				}
			]
		});

		await expect(
			classifyRetrievalScope({ userId: 'u1', query: 'Wer ist Clemmy?' })
		).resolves.toBe('local');
	});

	it('throws when the LLM returns empty content', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

		await expect(classifyRetrievalScope({ userId: 'u1', query: 'what am I about?' })).rejects.toThrow(
			'empty LLM response'
		);
	});
});
