import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateRelevanceQuestion } from '$lib/server/grounding/next-relevance-question';

const { llmChatCompletionMock, loadCandidatesMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn(),
	loadCandidatesMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

vi.mock('$lib/server/grounding/relevance-candidates', () => ({
	loadRelevanceCheckInCandidates: loadCandidatesMock
}));

describe('generateRelevanceQuestion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		loadCandidatesMock.mockResolvedValue([
			{
				id: '11111111-1111-4111-8111-111111111111',
				normalizedText: 'Old sketch about weekend markets',
				category: 'idea',
				memoryType: 'episodic',
				salienceScore: 0.4,
				inactiveDays: 40
			}
		]);
	});

	it('returns null when there are no candidates', async () => {
		loadCandidatesMock.mockResolvedValue([]);
		expect(await generateRelevanceQuestion('u1')).toBeNull();
		expect(llmChatCompletionMock).not.toHaveBeenCalled();
	});

	it('returns approved template question for a candidate thought', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							templateId: 'thought_still_relevant',
							thoughtId: '11111111-1111-4111-8111-111111111111'
						})
					}
				}
			]
		});

		const result = await generateRelevanceQuestion('u1');
		expect(result).toMatchObject({
			kind: 'relevance',
			templateId: 'thought_still_relevant',
			thoughtId: '11111111-1111-4111-8111-111111111111',
			snippet: 'Old sketch about weekend markets'
		});
		expect(result?.question).toContain('still relevant');
	});

	it('returns null when LLM skips', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: JSON.stringify({ skip: true }) } }]
		});
		expect(await generateRelevanceQuestion('u1')).toBeNull();
	});

	it('returns null for thoughtIds not in the candidate list', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							templateId: 'thought_still_relevant',
							thoughtId: '22222222-2222-4222-8222-222222222222'
						})
					}
				}
			]
		});
		expect(await generateRelevanceQuestion('u1')).toBeNull();
	});

	it('returns null for free-form question shapes', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							question: 'Do you still care about weekend markets?'
						})
					}
				}
			]
		});
		expect(await generateRelevanceQuestion('u1')).toBeNull();
	});
});
