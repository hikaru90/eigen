import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyThoughtEditRequest } from './apply-thought-edit';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function mockLlmContent(content: string) {
	llmChatCompletionMock.mockResolvedValue({
		choices: [{ message: { content } }]
	});
}

describe('applyThoughtEditRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses LLM for completion-only requests (no regex shortcut)', async () => {
		mockLlmContent(
			JSON.stringify({
				rawText: 'Buy milk',
				status: 'completed',
				summary: 'Marked as completed.'
			})
		);
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'mark as completed'
		});
		expect(llmChatCompletionMock).toHaveBeenCalled();
		expect(out.rawText).toBe('Buy milk');
		expect(out.status).toBe('completed');
	});

	it('throws when edit request is empty', async () => {
		await expect(
			applyThoughtEditRequest({
				userId: 'u1',
				existingRawText: 'Buy milk',
				existingNormalizedText: 'Buy milk',
				category: 'task',
				editRequest: '   '
			})
		).rejects.toThrow('editRequest is required');
	});

	it('calls LLM for substantive edits', async () => {
		mockLlmContent(
			JSON.stringify({
				rawText: 'Buy oat milk',
				status: null,
				summary: 'Changed milk to oat milk.'
			})
		);
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

	it('parses fenced JSON from the LLM response', async () => {
		mockLlmContent(
			'```json\n' +
				JSON.stringify({
					rawText: 'Buy oat milk',
					status: 'open',
					summary: 'Reworded milk type.'
				}) +
				'\n```'
		);
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'change to oat milk'
		});
		expect(out.rawText).toBe('Buy oat milk');
		expect(out.status).toBe('open');
	});

	it('falls back to existing raw text when LLM omits rawText', async () => {
		mockLlmContent(
			JSON.stringify({
				status: 'completed',
				summary: 'Marked complete.'
			})
		);
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'rewrite to say buy oat milk'
		});
		expect(out.rawText).toBe('Buy milk');
		expect(out.status).toBe('completed');
	});

	it('uses default summary when LLM omits summary', async () => {
		mockLlmContent(
			JSON.stringify({
				rawText: 'Buy oat milk',
				status: null
			})
		);
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'change to oat milk'
		});
		expect(out.summary).toBe('Thought updated.');
	});

	it('throws when LLM returns empty rawText', async () => {
		mockLlmContent(
			JSON.stringify({
				rawText: '   ',
				status: null,
				summary: 'Cleared text.'
			})
		);
		await expect(
			applyThoughtEditRequest({
				userId: 'u1',
				existingRawText: 'Buy milk',
				existingNormalizedText: 'Buy milk',
				category: 'task',
				editRequest: 'change to oat milk'
			})
		).rejects.toThrow('Failed to parse thought edit LLM response');
	});

	it('wraps invalid JSON responses in a parse error', async () => {
		mockLlmContent('not json');
		await expect(
			applyThoughtEditRequest({
				userId: 'u1',
				existingRawText: 'Buy milk',
				existingNormalizedText: 'Buy milk',
				category: 'task',
				editRequest: 'change to oat milk'
			})
		).rejects.toThrow('Failed to parse thought edit LLM response');
	});

	it('preserves explicit null status from the LLM response', async () => {
		mockLlmContent('{"rawText":"Buy oat milk","status":null,"summary":"Updated milk type."}');
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'change to oat milk'
		});
		expect(out.status).toBeNull();
	});

	it('leaves status undefined when the LLM omits status', async () => {
		mockLlmContent(JSON.stringify({ rawText: 'Buy oat milk', summary: 'Updated milk type.' }));
		const out = await applyThoughtEditRequest({
			userId: 'u1',
			existingRawText: 'Buy milk',
			existingNormalizedText: 'Buy milk',
			category: 'task',
			editRequest: 'change to oat milk'
		});
		expect(out.status).toBeUndefined();
	});

	it('wraps non-Error parse failures with a string message', async () => {
		mockLlmContent('{"rawText":"Buy oat milk","status":"open","summary":"ok"}');
		const parseSpy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
			throw 'bad json';
		});
		await expect(
			applyThoughtEditRequest({
				userId: 'u1',
				existingRawText: 'Buy milk',
				existingNormalizedText: 'Buy milk',
				category: 'task',
				editRequest: 'change to oat milk'
			})
		).rejects.toThrow('Failed to parse thought edit LLM response: bad json');
		parseSpy.mockRestore();
	});
});
