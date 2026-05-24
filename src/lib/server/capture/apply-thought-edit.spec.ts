import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThoughtEditRequest } from './apply-thought-edit';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

describe('applyThoughtEditRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('marks complete without LLM when request is completion-only', async () => {
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'mark as completed'
		});
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
		expect(out.rawText).toBe('Buy milk');
		expect(out.status).toBe('completed');
		expect(out.summary).toContain('Marked as completed');
	});

	it('calls LLM for substantive edits', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							rawText: 'Buy oat milk',
							status: null,
							summary: 'Changed milk to oat milk.'
						})
					}
				}
			]
		});
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'change to oat milk'
		});
		expect(llmChatCompletionMock).toHaveBeenCalled();
		expect(out.rawText).toBe('Buy oat milk');
		expect(out.summary).toContain('oat milk');
	});
});
