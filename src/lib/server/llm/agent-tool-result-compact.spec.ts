import { describe, expect, it } from 'vitest';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { maxFusedRrfScore } from '$lib/server/retrieval/rrf-scoring';
import {
	compactToolResultForLlm,
	findUniqueStrongRetrieveMatch,
	formatToolResultForAgentMessage,
	isDeleteIntent,
	MAX_TOOL_RESULT_JSON_CHARS,
	STRONG_RETRIEVE_MATCH_MIN
} from './agent-tool-result-compact';

describe('agent-tool-result-compact', () => {
	it('detects delete intent in user messages', () => {
		expect(isDeleteIntent('please delete the note about groceries')).toBe(true);
		expect(isDeleteIntent('what did I capture yesterday?')).toBe(false);
	});

	it('finds a unique strong retrieve match', () => {
		const weights = CONTEXT_WEIGHTS.default;
		const strongScore = maxFusedRrfScore(weights) * STRONG_RETRIEVE_MATCH_MIN;
		const weakScore = strongScore * 0.1;
		const match = findUniqueStrongRetrieveMatch(
			[
				{ id: 't-strong', normalizedText: 'Buy milk', score: strongScore },
				{ id: 't-weak', normalizedText: 'Other', score: weakScore }
			],
			weights
		);
		expect(match).toEqual({ id: 't-strong', snippet: 'Buy milk' });
	});

	it('returns null when multiple strong matches exist', () => {
		const weights = CONTEXT_WEIGHTS.default;
		const strongScore = maxFusedRrfScore(weights) * STRONG_RETRIEVE_MATCH_MIN;
		expect(
			findUniqueStrongRetrieveMatch(
				[
					{ id: 'a', normalizedText: 'A', score: strongScore },
					{ id: 'b', normalizedText: 'B', score: strongScore }
				],
				weights
			)
		).toBeNull();
	});

	it('compacts retrieve results and caps agent message JSON size', () => {
		const weights = CONTEXT_WEIGHTS.default;
		const results = Array.from({ length: 50 }, (_, i) => ({
			id: `t-${i}`,
			normalizedText: 'x'.repeat(500),
			category: 'thought',
			score: maxFusedRrfScore(weights),
			metadata: { graph: { nodes: Array.from({ length: 20 }, () => 'n') } }
		}));
		const compact = compactToolResultForLlm('retrieve_thoughts', { results }, weights) as {
			candidates: unknown[];
			truncated: boolean;
		};
		expect(compact.candidates.length).toBeLessThanOrEqual(20);
		expect(compact.truncated).toBe(true);
		const agentMessage = formatToolResultForAgentMessage('retrieve_thoughts', { results }, weights);
		expect(agentMessage.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_JSON_CHARS);
		expect(agentMessage).not.toContain('"metadata"');
	});

	it('strips embeddings from list_thoughts compact output', () => {
		const compact = compactToolResultForLlm('list_thoughts', {
			thoughts: [
				{
					id: 't1',
					normalizedText: 'Hello',
					embedding: Array.from({ length: 1536 }, () => 0.1)
				}
			]
		}) as { thoughts: Array<Record<string, unknown>> };
		expect(compact.thoughts[0].snippet).toBe('Hello');
		expect(compact.thoughts[0]).not.toHaveProperty('embedding');
	});
});
