import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyMemoryType } from './classify-memory-type';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function makeResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('classifyMemoryType', () => {
	beforeEach(() => vi.clearAllMocks());
	it.each([
		['episode', 'Met Anna at the office, she was frustrated about the deadline'],
		['fact', 'Anna is head of product at Company X'],
		['decision', 'We decided to go with option B for the pricing model'],
		['concern', "I'm worried the contract renewal is at risk"],
		['open_loop', 'Need to follow up with Marcus about the proposal'],
		['preference', 'I work better in the morning before meetings start'],
		['pattern', 'Whenever I am stressed I tend to defer important decisions']
	] as const)('returns %s for appropriate input', async (expectedType, text) => {
		llmChatCompletionMock.mockResolvedValue(makeResponse(expectedType));

		const result = await classifyMemoryType({ userId: 'u1', normalizedText: text });
		expect(result).toBe(expectedType);
	});

	it('trims whitespace from LLM response', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('  episode\n'));
		const result = await classifyMemoryType({ userId: 'u1', normalizedText: 'something' });
		expect(result).toBe('episode');
	});

	it('throws when LLM returns an invalid type', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('unknown_type'));
		await expect(classifyMemoryType({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow(
			'unexpected type'
		);
	});

	it('throws when LLM response has no choices', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [] });
		await expect(classifyMemoryType({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow();
	});

	it('throws when LLM call fails', async () => {
		llmChatCompletionMock.mockRejectedValue(new Error('LLM unavailable'));
		await expect(classifyMemoryType({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow(
			'LLM unavailable'
		);
	});

	it('passes the normalized text in the prompt', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('fact'));
		await classifyMemoryType({ userId: 'u1', normalizedText: 'specific text here' });

		const call = llmChatCompletionMock.mock.calls.at(-1)![0];
		const userMessage = call.messages.find((m: { role: string }) => m.role === 'user');
		expect(userMessage.content).toContain('specific text here');
	});
});
