import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CHAT_INTENT_CLASSIFIER_PROMPT,
	classifyChatIntent,
	parseChatIntentResponse
} from './classify-chat-intent';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function chatResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('parseChatIntentResponse', () => {
	it('parses answer, capture, and manage intents from JSON', () => {
		expect(parseChatIntentResponse('{"intent":"answer"}')).toBe('answer');
		expect(parseChatIntentResponse('{"intent":"capture"}')).toBe('capture');
		expect(parseChatIntentResponse('{"intent":"manage"}')).toBe('manage');
		expect(parseChatIntentResponse('```json\n{"intent":"answer"}\n```')).toBe('answer');
	});

	it('throws on invalid intent values', () => {
		expect(() => parseChatIntentResponse('{"intent":"save"}')).toThrow(
			'intent must be "answer", "capture", or "manage"'
		);
		expect(() => parseChatIntentResponse('not json')).toThrow();
	});
});

describe('CHAT_INTENT_CLASSIFIER_PROMPT', () => {
	it('includes multilingual question vs capture guidance', () => {
		expect(CHAT_INTENT_CLASSIFIER_PROMPT).toContain('Wie koche ich Japanese-Glazed Salmon?');
		expect(CHAT_INTENT_CLASSIFIER_PROMPT).toContain('Questions are never capture');
	});
});

describe('classifyChatIntent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns answer for a German cooking question', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('{"intent":"answer"}'));

		await expect(
			classifyChatIntent({
				userId: 'u1',
				userMessage: 'Wie koche ich Japanese-Glazed Salmon?'
			})
		).resolves.toBe('answer');

		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				temperature: 0,
				logContext: 'chat_intent_classifier',
				messages: expect.arrayContaining([
					expect.objectContaining({
						role: 'user',
						content: 'Wie koche ich Japanese-Glazed Salmon?'
					})
				])
			})
		);
	});

	it('returns capture for explicit remember intent', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('{"intent":"capture"}'));

		await expect(
			classifyChatIntent({
				userId: 'u1',
				userMessage: 'remember I love salmon with mirin glaze'
			})
		).resolves.toBe('capture');
	});

	it('returns manage for delete/list/completion requests', async () => {
		llmChatCompletionMock.mockResolvedValue(chatResponse('{"intent":"manage"}'));

		await expect(
			classifyChatIntent({
				userId: 'u1',
				userMessage: 'delete the salmon note'
			})
		).resolves.toBe('manage');
	});

	it('throws when the LLM returns empty content', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

		await expect(
			classifyChatIntent({ userId: 'u1', userMessage: 'What did I capture?' })
		).rejects.toThrow('empty LLM response');
	});
});
