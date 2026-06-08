import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DELETE_INTENT_CLASSIFIER_PROMPT,
	classifyDeleteIntent,
	parseDeleteIntentResponse
} from './classify-delete-intent';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function chatResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('parseDeleteIntentResponse', () => {
	it('parses true and false from JSON', () => {
		expect(parseDeleteIntentResponse('{"delete":true}')).toBe(true);
		expect(parseDeleteIntentResponse('{"delete":false}')).toBe(false);
		expect(parseDeleteIntentResponse('```json\n{"delete":true}\n```')).toBe(true);
	});

	it('throws on invalid delete values', () => {
		expect(() => parseDeleteIntentResponse('{"delete":"yes"}')).toThrow(
			'delete must be true or false'
		);
		expect(() => parseDeleteIntentResponse('not json')).toThrow();
	});
});

describe('DELETE_INTENT_CLASSIFIER_PROMPT', () => {
	it('includes multilingual delete guidance', () => {
		expect(DELETE_INTENT_CLASSIFIER_PROMPT).toContain('lösche die Notiz über Milch');
		expect(DELETE_INTENT_CLASSIFIER_PROMPT).toContain('Classify by intent, not by keywords');
	});
});

describe('classifyDeleteIntent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns true for explicit delete requests', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('{"delete":true}'));

		await expect(
			classifyDeleteIntent({
				userId: 'u1',
				userMessage: 'delete the salmon note'
			})
		).resolves.toBe(true);

		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				temperature: 0,
				logContext: 'delete_intent_classifier'
			})
		);
	});

	it('returns false for questions and other manage intents', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('{"delete":false}'));

		await expect(
			classifyDeleteIntent({
				userId: 'u1',
				userMessage: 'what did I note about salmon?'
			})
		).resolves.toBe(false);
	});

	it('returns false for empty messages without calling the LLM', async () => {
		await expect(classifyDeleteIntent({ userId: 'u1', userMessage: '   ' })).resolves.toBe(false);
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('throws when the LLM returns empty content', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

		await expect(
			classifyDeleteIntent({ userId: 'u1', userMessage: 'remove that note' })
		).rejects.toThrow('empty LLM response');
	});
});
