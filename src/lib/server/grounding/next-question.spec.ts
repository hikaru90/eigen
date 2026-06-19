import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateGroundingQuestion } from '$lib/server/grounding/next-question';

const { llmChatCompletionMock, loadGroundingProfileRowMock, loadRecentThoughtsMock } = vi.hoisted(
	() => ({
		llmChatCompletionMock: vi.fn(),
		loadGroundingProfileRowMock: vi.fn(),
		loadRecentThoughtsMock: vi.fn()
	})
);

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

vi.mock('$lib/server/grounding/profile', () => ({
	loadGroundingProfileRow: loadGroundingProfileRowMock
}));

vi.mock('$lib/server/grounding/question-due', () => ({
	loadRecentThoughtsForGroundingQuestion: loadRecentThoughtsMock
}));

describe('generateGroundingQuestion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadGroundingProfileRowMock.mockResolvedValue({ facets: {}, narrativeSummary: '' });
		loadRecentThoughtsMock.mockResolvedValue([
			{ normalizedText: 'Working on SPACE Hamburg launch', category: 'project' }
		]);
	});

	it('returns parsed facet question from LLM output', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							facetKey: 'work',
							question: 'What kind of work do you do day to day?'
						})
					}
				}
			]
		});

		const result = await generateGroundingQuestion('u1');
		expect(result).toEqual({
			facetKey: 'work',
			question: 'What kind of work do you do day to day?'
		});
	});

	it('returns null when LLM skips', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: JSON.stringify({ skip: true }) } }]
		});

		expect(await generateGroundingQuestion('u1')).toBeNull();
	});

	it('returns null for invalid facet keys', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({ facetKey: 'hobbies', question: 'What do you like?' })
					}
				}
			]
		});

		expect(await generateGroundingQuestion('u1')).toBeNull();
	});
});
