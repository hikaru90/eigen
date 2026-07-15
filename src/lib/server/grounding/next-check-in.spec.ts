import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateCheckInQuestion } from '$lib/server/grounding/next-check-in';

const { generateGroundingQuestionMock, generateRelevanceQuestionMock } = vi.hoisted(() => ({
	generateGroundingQuestionMock: vi.fn(),
	generateRelevanceQuestionMock: vi.fn()
}));

vi.mock('$lib/server/grounding/next-question', () => ({
	generateGroundingQuestion: generateGroundingQuestionMock
}));

vi.mock('$lib/server/grounding/next-relevance-question', () => ({
	generateRelevanceQuestion: generateRelevanceQuestionMock
}));

describe('generateCheckInQuestion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('prefers grounding when a blank exists', async () => {
		generateGroundingQuestionMock.mockResolvedValue({
			facetKey: 'work',
			question: 'Where do you work?'
		});

		await expect(generateCheckInQuestion('u1')).resolves.toEqual({
			kind: 'grounding',
			facetKey: 'work',
			question: 'Where do you work?'
		});
		expect(generateRelevanceQuestionMock).not.toHaveBeenCalled();
	});

	it('falls through to relevance when grounding skips', async () => {
		generateGroundingQuestionMock.mockResolvedValue(null);
		generateRelevanceQuestionMock.mockResolvedValue({
			kind: 'relevance',
			templateId: 'thought_still_relevant',
			thoughtId: 't1',
			snippet: 'Old note',
			question: 'Still relevant?'
		});

		await expect(generateCheckInQuestion('u1')).resolves.toMatchObject({
			kind: 'relevance',
			thoughtId: 't1'
		});
	});

	it('returns null when both skip', async () => {
		generateGroundingQuestionMock.mockResolvedValue(null);
		generateRelevanceQuestionMock.mockResolvedValue(null);
		await expect(generateCheckInQuestion('u1')).resolves.toBeNull();
	});
});
