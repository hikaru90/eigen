import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STRONG_RETRIEVE_MATCH_MIN } from '$lib/server/llm/agent-tool-result-compact';
import {
	buildDeleteTargetCandidates,
	parseDeleteTargetsResponse,
	resolveDeleteTargets,
	strongDeleteTargetCandidates
} from './resolve-delete-target';

const { llmChatCompletionMock } = vi.hoisted(() => ({
	llmChatCompletionMock: vi.fn()
}));

vi.mock('$lib/server/llm/llm-client', () => ({
	llmChatCompletion: llmChatCompletionMock
}));

describe('buildDeleteTargetCandidates', () => {
	it('maps retrieve rows to compact delete candidates', () => {
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		const candidates = buildDeleteTargetCandidates([
			{
				id: 't-salmon',
				normalizedText: 'Recipe: Japanese glazed salmon',
				category: 'reference',
				score: strongScore
			},
			{ id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: strongScore }
		]);
		expect(candidates).toHaveLength(2);
		expect(candidates[0].thoughtId).toBe('t-salmon');
		expect(candidates[0].snippet).toContain('Japanese glazed salmon');
		expect(candidates[0].scoreNormalized).toBeGreaterThanOrEqual(STRONG_RETRIEVE_MATCH_MIN);
	});

	it('filters to strong candidates only', () => {
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		const weakScore = STRONG_RETRIEVE_MATCH_MIN - 0.1;
		const all = buildDeleteTargetCandidates([
			{ id: 'strong', normalizedText: 'A', score: strongScore },
			{ id: 'weak', normalizedText: 'B', score: weakScore }
		]);
		expect(strongDeleteTargetCandidates(all).map((c) => c.thoughtId)).toEqual(['strong']);
	});
});

describe('parseDeleteTargetsResponse', () => {
	const candidates = buildDeleteTargetCandidates([
		{ id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
		{ id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 }
	]);

	it('parses one matching thoughtId', () => {
		expect(parseDeleteTargetsResponse('{"thoughtIds":["t-salmon"]}', candidates)).toEqual([
			expect.objectContaining({ thoughtId: 't-salmon' })
		]);
	});

	it('parses multiple matching thoughtIds', () => {
		expect(
			parseDeleteTargetsResponse('{"thoughtIds":["t-salmon","t-chicken"]}', candidates).map(
				(c) => c.thoughtId
			)
		).toEqual(['t-salmon', 't-chicken']);
	});

	it('parses empty array when nothing matches', () => {
		expect(parseDeleteTargetsResponse('{"thoughtIds":[]}', candidates)).toEqual([]);
	});

	it('accepts legacy single thoughtId responses', () => {
		expect(parseDeleteTargetsResponse('{"thoughtId":"t-salmon"}', candidates)).toEqual([
			expect.objectContaining({ thoughtId: 't-salmon' })
		]);
	});

	it('rejects ids not in the candidate list', () => {
		expect(() => parseDeleteTargetsResponse('{"thoughtIds":["missing"]}', candidates)).toThrow(
			/must reference listed candidates/
		);
	});
});

describe('resolveDeleteTargets', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the LLM-selected candidates', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: '{"thoughtIds":["t-salmon"]}' } }]
		});
		const candidates = buildDeleteTargetCandidates([
			{ id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
			{ id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 }
		]);

		await expect(
			resolveDeleteTargets({
				userId: 'u1',
				deleteRequest: 'delete the Japanese glazed salmon recipe',
				candidates
			})
		).resolves.toEqual([expect.objectContaining({ thoughtId: 't-salmon' })]);

		expect(llmChatCompletionMock).toHaveBeenCalledWith(
			expect.objectContaining({ logContext: 'delete_target_resolver' })
		);
	});

	it('returns multiple targets when the user asks to delete several matches', async () => {
		llmChatCompletionMock.mockResolvedValue({
			choices: [{ message: { content: '{"thoughtIds":["t-salmon","t-chicken"]}' } }]
		});
		const candidates = buildDeleteTargetCandidates([
			{ id: 't-salmon', normalizedText: 'Recipe: Japanese glazed salmon', score: 0.9 },
			{ id: 't-chicken', normalizedText: 'Recipe: Lemon Herb Roast Chicken', score: 0.9 }
		]);

		await expect(
			resolveDeleteTargets({
				userId: 'u1',
				deleteRequest: 'delete all my recipe notes',
				candidates
			})
		).resolves.toHaveLength(2);
	});
});
