import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractThoughtMetadata, normalizeMemoryType } from './extract-thought-metadata';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function makeResponse(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('extractThoughtMetadata', () => {
	beforeEach(() => vi.clearAllMocks());

	it('parses memory type and cues from JSON', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse(
				JSON.stringify({
					memoryType: 'episode',
					cues: ['office meeting', 'deadline stress', 'anna frustration']
				})
			)
		);

		const result = await extractThoughtMetadata({
			userId: 'u1',
			normalizedText: 'Met Anna at the office.'
		});

		expect(result).toEqual({
			memoryType: 'episode',
			cues: ['office meeting', 'deadline stress', 'anna frustration']
		});
	});

	it('normalizes memory type casing and trims cues', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse(
				JSON.stringify({
					memoryType: ' OPEN_LOOP ',
					cues: ['  follow up marcus  ', 'x', `${'way-too-long-'.repeat(12)}cue`]
				})
			)
		);

		const result = await extractThoughtMetadata({
			userId: 'u1',
			normalizedText: 'Need to follow up.'
		});

		expect(result.memoryType).toBe('open_loop');
		expect(result.cues).toEqual(['follow up marcus']);
	});

	it('returns null for drift labels without synonym remapping', () => {
		expect(normalizeMemoryType('idea')).toBeNull();
		expect(normalizeMemoryType('task')).toBeNull();
	});

	it('accepts memory_type as a JSON key alias', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse(JSON.stringify({ memory_type: 'fact', cues: ['standing truth'] }))
		);

		const result = await extractThoughtMetadata({ userId: 'u1', normalizedText: 'text' });
		expect(result.memoryType).toBe('fact');
	});

	it('retries with strict prompt when first pass returns drift label', async () => {
		llmChatCompletionMock
			.mockResolvedValueOnce(makeResponse(JSON.stringify({ memoryType: 'task', cues: [] })))
			.mockResolvedValueOnce(makeResponse(JSON.stringify({ memoryType: 'open_loop', cues: ['follow up'] })));

		const result = await extractThoughtMetadata({ userId: 'u1', normalizedText: 'Need to follow up.' });

		expect(result.memoryType).toBe('open_loop');
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
		expect(llmChatCompletionMock.mock.calls[1]?.[0]?.messages?.[1]?.content).toContain('task');
	});

	it('throws when memoryType is invalid on both passes', async () => {
		llmChatCompletionMock.mockResolvedValue(
			makeResponse(JSON.stringify({ memoryType: 'unknown', cues: [] }))
		);

		await expect(
			extractThoughtMetadata({ userId: 'u1', normalizedText: 'text' })
		).rejects.toThrow(/invalid memoryType "unknown"/);
		expect(llmChatCompletionMock).toHaveBeenCalledTimes(2);
	});

	it('throws when response has no choices', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [] });

		await expect(
			extractThoughtMetadata({ userId: 'u1', normalizedText: 'text' })
		).rejects.toThrow(/no choices/);
	});

	it('throws when output is not a JSON object', async () => {
		llmChatCompletionMock.mockResolvedValue(makeResponse('null'));

		await expect(
			extractThoughtMetadata({ userId: 'u1', normalizedText: 'text' })
		).rejects.toThrow(/JSON object/);
	});
});
