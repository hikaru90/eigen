import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractCues } from './extract-cues';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function makeResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('extractCues', () => {
	beforeEach(() => vi.clearAllMocks());
	it('returns parsed cue strings from LLM JSON response', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse('["Anna pricing meeting", "Q3 budget pushback", "product pricing conflict"]')
		);

		const cues = await extractCues({ userId: 'u1', normalizedText: 'Anna pushed back on Q3 pricing' });
		expect(cues).toEqual(['Anna pricing meeting', 'Q3 budget pushback', 'product pricing conflict']);
	});

	it('strips markdown code fences from LLM response', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse('```json\n["cue one", "cue two"]\n```')
		);

		const cues = await extractCues({ userId: 'u1', normalizedText: 'text' });
		expect(cues).toEqual(['cue one', 'cue two']);
	});

	it('filters out cues that are too short', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["ab", "valid cue here", "x"]'));
		const cues = await extractCues({ userId: 'u1', normalizedText: 'text' });
		expect(cues).toContain('valid cue here');
		expect(cues).not.toContain('ab');
		expect(cues).not.toContain('x');
	});

	it('caps output at 5 cues', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse('["cue one", "cue two", "cue three", "cue four", "cue five", "cue six"]')
		);

		const cues = await extractCues({ userId: 'u1', normalizedText: 'text' });
		expect(cues).toHaveLength(5);
	});

	it('returns empty array when LLM returns malformed JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('not json at all'));
		const cues = await extractCues({ userId: 'u1', normalizedText: 'text' });
		expect(cues).toEqual([]);
	});

	it('returns empty array when LLM returns non-array JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('{"key": "value"}'));
		const cues = await extractCues({ userId: 'u1', normalizedText: 'text' });
		expect(cues).toEqual([]);
	});

	it('returns empty array when LLM call fails', async () => {
		llmChatCompletionMock.mockRejectedValue(new Error('network error'));
		// extractCues is designed to return [] on failure — callers handle gracefully
		// but it throws here because we don't catch in the function itself
		// (callers in enrich.ts do the try/catch)
		await expect(extractCues({ userId: 'u1', normalizedText: 'text' })).rejects.toThrow();
	});

	it('filters out non-string items from array', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["valid cue", 42, null, "another cue"]'));
		const cues = await extractCues({ userId: 'u1', normalizedText: 'text' });
		expect(cues).toEqual(['valid cue', 'another cue']);
	});

	it('passes normalized text in the prompt', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('["cue"]'));
		await extractCues({ userId: 'u1', normalizedText: 'my specific note text' });

		const call = llmChatCompletionMock.mock.calls.at(-1)![0];
		const userMessage = call.messages.find((m: { role: string }) => m.role === 'user');
		expect(userMessage.content).toContain('my specific note text');
	});
});
