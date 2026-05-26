import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractTemporalMentions } from './temporal-extraction';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

function llmContent(content: string) {
	return { choices: [{ message: { content } }] };
}

describe('extractTemporalMentions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns parsed mentions from a JSON array response', async () => {
		llmChatCompletionMock.mockResolvedValue(
			llmContent(
				`[{"surface":"due Friday","kind":"deadline","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Report due Friday"}]`
			)
		);

		const mentions = await extractTemporalMentions({
			userId: 'u1',
			normalizedText: 'Report due Friday',
			capturedAt: new Date('2026-05-20T12:00:00.000Z'),
			timezone: 'UTC'
		});

		expect(mentions).toHaveLength(1);
		expect(mentions[0]?.kind).toBe('deadline');
		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'u1',
				temperature: 0
			})
		);
	});

	it('unwraps { events: [...] } payloads from the model', async () => {
		llmChatCompletionMock.mockResolvedValue(
			llmContent(
				'```json\n{"events":[{"surface":"next Wednesday","kind":"appointment","startAt":"2026-05-27T15:00:00.000Z","timePrecision":"exact","timezone":"UTC","isAllDay":false,"confidence":0.8,"semanticSummary":"Dentist appointment"}]}\n```'
			)
		);

		const mentions = await extractTemporalMentions({
			userId: 'u1',
			normalizedText: 'Dentist next Wednesday at 3pm',
			capturedAt: new Date('2026-05-20T12:00:00.000Z'),
			timezone: 'UTC'
		});

		expect(mentions).toHaveLength(1);
		expect(mentions[0]?.kind).toBe('appointment');
	});

	it('throws when the LLM response has no choices', async () => {
		llmChatCompletionMock.mockResolvedValue({ choices: [] });

		await expect(
			extractTemporalMentions({
				userId: 'u1',
				normalizedText: 'no dates here',
				capturedAt: new Date('2026-05-20T12:00:00.000Z'),
				timezone: 'UTC'
			})
		).rejects.toThrow(/no choices/);
	});
});
