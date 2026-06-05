import { describe, expect, it, vi } from 'vitest';
import * as stripEmbeddings from '$lib/server/observability/strip-embeddings';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { maxFusedRrfScore } from '$lib/server/retrieval/rrf-scoring';
import {
	compactToolResultForLlm,
	findUniqueStrongRetrieveMatch,
	formatToolResultForAgentMessage,
	formatToolResultPreview,
	isDeleteIntent,
	MAX_TOOL_RESULT_JSON_CHARS,
	MAX_TOOL_RESULT_PREVIEW_CHARS,
	STRONG_RETRIEVE_MATCH_MIN,
	THOUGHT_SNIPPET_MAX_CHARS
} from './agent-tool-result-compact';

describe('agent-tool-result-compact', () => {
	describe('isDeleteIntent', () => {
		it.each([
			'please delete the note about groceries',
			'remove that thought',
			'erase my capture',
			'drop the entry',
			'get rid of the old note',
			'throw away that memory',
			'discard the draft'
		])('detects delete intent: %s', (message) => {
			expect(isDeleteIntent(message)).toBe(true);
		});

		it('trims whitespace before matching', () => {
			expect(isDeleteIntent('  \n delete this  ')).toBe(true);
		});

		it('returns false for non-delete messages', () => {
			expect(isDeleteIntent('what did I capture yesterday?')).toBe(false);
		});
	});

	describe('findUniqueStrongRetrieveMatch', () => {
		const weights = CONTEXT_WEIGHTS.default;
		const strongScore = STRONG_RETRIEVE_MATCH_MIN + 0.1;
		const weakScore = STRONG_RETRIEVE_MATCH_MIN - 0.1;

		it('finds a unique strong retrieve match from normalizedText', () => {
			const match = findUniqueStrongRetrieveMatch(
				[
					{ id: 't-strong', normalizedText: 'Buy milk', score: strongScore },
					{ id: 't-weak', normalizedText: 'Other', score: weakScore }
				],
				weights
			);
			expect(match).toEqual({ id: 't-strong', snippet: 'Buy milk' });
		});

		it('returns empty snippet when strong match has no text fields', () => {
			const match = findUniqueStrongRetrieveMatch(
				[{ id: 't-empty', score: strongScore }],
				weights
			);
			expect(match).toEqual({ id: 't-empty', snippet: '' });
		});

		it('uses rawText when normalizedText is absent', () => {
			const match = findUniqueStrongRetrieveMatch(
				[{ id: 't-raw', rawText: 'From raw', score: strongScore }],
				weights
			);
			expect(match).toEqual({ id: 't-raw', snippet: 'From raw' });
		});

		it('truncates long snippets', () => {
			const longText = 'x'.repeat(THOUGHT_SNIPPET_MAX_CHARS + 50);
			const match = findUniqueStrongRetrieveMatch(
				[{ id: 't-long', normalizedText: longText, score: strongScore }],
				weights
			);
			expect(match?.snippet.length).toBe(THOUGHT_SNIPPET_MAX_CHARS);
			expect(match?.snippet.endsWith('...')).toBe(true);
		});

		it('returns null when multiple strong matches exist', () => {
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

		it('returns null when no strong matches exist', () => {
			expect(
				findUniqueStrongRetrieveMatch(
					[{ id: 'weak', normalizedText: 'W', score: weakScore }],
					weights
				)
			).toBeNull();
		});

		it('returns null for empty or non-array input', () => {
			expect(findUniqueStrongRetrieveMatch([], weights)).toBeNull();
			expect(findUniqueStrongRetrieveMatch(null as unknown as unknown[], weights)).toBeNull();
		});

		it('skips rows without string id or non-object rows', () => {
			expect(
				findUniqueStrongRetrieveMatch(
					[
						{ normalizedText: 'no id', score: strongScore },
						'not-an-object',
						{ id: 'ok', normalizedText: 'Only one', score: strongScore }
					],
					weights
				)
			).toEqual({ id: 'ok', snippet: 'Only one' });
		});

		it('treats missing score as zero', () => {
			expect(
				findUniqueStrongRetrieveMatch([{ id: 't1', normalizedText: 'Hi' }], weights)
			).toBeNull();
		});
	});

	describe('compactToolResultForLlm', () => {
		const weights = CONTEXT_WEIGHTS.default;

		it('passes through null and undefined', () => {
			expect(compactToolResultForLlm('any_tool', null)).toBeNull();
			expect(compactToolResultForLlm('any_tool', undefined)).toBeUndefined();
		});

		it('returns stripped null when value is a bare embedding vector', () => {
			const embedding = Array.from({ length: 1536 }, () => 0.1);
			expect(compactToolResultForLlm('any_tool', embedding)).toBeUndefined();
		});

		it('returns original result for non-record values after strip', () => {
			expect(compactToolResultForLlm('unknown_tool', 'plain string')).toBe('plain string');
			expect(compactToolResultForLlm('unknown_tool', [1, 2, 3])).toEqual([1, 2, 3]);
		});

		it('returns original result for unknown tools with object payloads', () => {
			const payload = { custom: 'data', nested: { a: 1 } };
			expect(compactToolResultForLlm('custom_tool', payload)).toBe(payload);
		});

		it('does not compact retrieve_thoughts when results is not an array', () => {
			const payload = { results: 'not-array' };
			expect(compactToolResultForLlm('retrieve_thoughts', payload)).toBe(payload);
		});

		it('compacts retrieve results, normalizes scores, and sets truncated flag', () => {
			const small = compactToolResultForLlm('retrieve_thoughts', {
				results: [{ id: 't1', normalizedText: 'Hi', score: 0.8 }]
			}) as { count: number; truncated: boolean; candidates: Array<{ scoreNormalized: number }> };
			expect(small.count).toBe(1);
			expect(small.truncated).toBe(false);
			expect(small.candidates[0].scoreNormalized).toBe(0.8);

			const large = compactToolResultForLlm(
				'retrieve_thoughts',
				{
					results: Array.from({ length: 50 }, (_, i) => ({
						id: `t-${i}`,
						normalizedText: 'x'.repeat(500),
						category: 'thought',
						score: maxFusedRrfScore(weights),
						metadata: { graph: { nodes: Array.from({ length: 20 }, () => 'n') } }
					}))
				},
				weights
			) as { candidates: unknown[]; truncated: boolean };
			expect(large.candidates.length).toBeLessThanOrEqual(20);
			expect(large.truncated).toBe(true);
		});

		it('leaves id, thoughtId, and category undefined when not strings', () => {
			const compact = compactToolResultForLlm('list_thoughts', {
				thoughts: [{ id: 99, thoughtId: 100, category: 1, normalizedText: 'x' }]
			}) as { thoughts: Array<Record<string, unknown>> };
			expect(compact.thoughts[0].id).toBeUndefined();
			expect(compact.thoughts[0].thoughtId).toBeUndefined();
			expect(compact.thoughts[0].category).toBeUndefined();
		});

		it('handles non-record retrieve rows and missing scores', () => {
			const compact = compactToolResultForLlm('retrieve_thoughts', {
				results: ['bad-row', { id: 't1', rawText: 'from raw' }]
			}) as { candidates: Array<Record<string, unknown>> };
			expect(compact.candidates[0].scoreNormalized).toBe(0);
			expect(compact.candidates[1].snippet).toBe('from raw');
		});

		it('strips embeddings from list_thoughts and compacts thought fields', () => {
			const compact = compactToolResultForLlm('list_thoughts', {
				thoughts: [
					{
						thoughtId: 't1',
						rawText: 'Hello',
						category: 'idea',
						createdAt: '2024-06-01T12:00:00.000Z',
						temporalStatus: 'active',
						temporalSummary: 'still relevant',
						embedding: Array.from({ length: 1536 }, () => 0.1)
					},
					{
						id: 't2',
						text: 'Via text field',
						createdAt: '2024-01-01',
						temporalStatus: 'invalid'
					},
					{
						id: 't3',
						snippet: 'precomputed snippet'
					},
					{
						id: 't4',
						normalizedText: 'expired note',
						temporalStatus: 'expired'
					},
					{
						id: 't5',
						normalizedText: 'timeless',
						temporalStatus: 'none'
					}
				]
			}) as {
				count: number;
				truncated: boolean;
				thoughts: Array<Record<string, unknown>>;
			};
			expect(compact.thoughts[0].snippet).toBe('Hello');
			expect(compact.thoughts[0]).not.toHaveProperty('embedding');
			expect(compact.thoughts[0].thoughtId).toBe('t1');
			expect(compact.thoughts[0].createdAt).toBe('2024-06-01T12:00:00.000Z');
			expect(compact.thoughts[0].temporalStatus).toBe('active');
			expect(compact.thoughts[0].temporalSummary).toBe('still relevant');
			expect(compact.thoughts[1].snippet).toBe('Via text field');
			expect(compact.thoughts[1].temporalStatus).toBeUndefined();
			expect(compact.thoughts[2].snippet).toBe('precomputed snippet');
			expect(compact.thoughts[3].temporalStatus).toBe('expired');
			expect(compact.thoughts[4].temporalStatus).toBe('none');
		});

		it('serializes Date createdAt when strip preserves object shape', () => {
			const spy = vi
				.spyOn(stripEmbeddings, 'stripEmbeddingsFromValue')
				.mockImplementation((value) => value);
			const createdAt = new Date('2024-06-01T12:00:00.000Z');
			const compact = compactToolResultForLlm('list_thoughts', {
				thoughts: [{ id: 't-date', normalizedText: 'dated', createdAt }]
			}) as { thoughts: Array<Record<string, unknown>> };
			expect(compact.thoughts[0].createdAt).toBe('2024-06-01T12:00:00.000Z');
			spy.mockRestore();
		});

		it('sets truncated false when thoughts fit within MAX_CANDIDATES', () => {
			const compact = compactToolResultForLlm('list_thoughts', {
				thoughts: [
					null,
					'not-a-row',
					{ id: 't1', normalizedText: 'one' },
					{ id: 't2', normalizedText: 'two' }
				]
			}) as { count: number; truncated: boolean; thoughts: unknown[] };
			expect(compact.count).toBe(4);
			expect(compact.thoughts).toHaveLength(4);
			expect(compact.truncated).toBe(false);
		});

		it('truncates list_thoughts to MAX_CANDIDATES', () => {
			const compact = compactToolResultForLlm('list_thoughts', {
				thoughts: Array.from({ length: 25 }, (_, i) => ({
					id: `t-${i}`,
					normalizedText: `thought ${i}`
				}))
			}) as { count: number; truncated: boolean; thoughts: unknown[] };
			expect(compact.count).toBe(25);
			expect(compact.thoughts).toHaveLength(20);
			expect(compact.truncated).toBe(true);
		});

		it('does not compact list_thoughts when thoughts is not an array', () => {
			const payload = { thoughts: 'nope' };
			expect(compactToolResultForLlm('list_thoughts', payload)).toBe(payload);
		});

		it('compacts edit_thought before/after rows', () => {
			const edit = compactToolResultForLlm('edit_thought', {
				thoughtId: 't1',
				summary: 'Updated',
				editRequest: 'fix typo',
				before: { id: 't1', normalizedText: 'old' },
				after: { id: 't1', normalizedText: 'new' }
			}) as Record<string, unknown>;
			expect(edit.thoughtId).toBe('t1');
			expect((edit.before as { snippet: string }).snippet).toBe('old');
			expect((edit.after as { snippet: string }).snippet).toBe('new');
		});

		it('compacts edit_thought when before/after are not objects', () => {
			const edit = compactToolResultForLlm('edit_thought', {
				thoughtId: 't1',
				before: null,
				after: 'not-an-object'
			}) as Record<string, unknown>;
			expect((edit.before as Record<string, unknown>).snippet).toBeUndefined();
			expect((edit.after as Record<string, unknown>).snippet).toBeUndefined();
		});

		it('compacts capture_thought with and without thought object', () => {
			const withThought = compactToolResultForLlm('capture_thought', {
				thoughtId: 't2',
				thought: { id: 't2', normalizedText: 'captured' }
			}) as Record<string, unknown>;
			expect(withThought.thoughtId).toBe('t2');
			expect((withThought.thought as { snippet: string }).snippet).toBe('captured');

			const withoutThought = compactToolResultForLlm('capture_thought', {
				thoughtId: 't3'
			}) as Record<string, unknown>;
			expect(withoutThought.thought).toBeUndefined();
		});

		it('compacts answer_question answer, citations, and error branches', () => {
			const full = compactToolResultForLlm('answer_question', {
				answer: 'A'.repeat(3_000),
				citations: [{ id: 't1' }],
				error: '  partial failure  '
			}) as Record<string, unknown>;
			expect(full.citationCount).toBe(1);
			expect(String(full.answer).length).toBeLessThanOrEqual(2_000);
			expect(full.error).toBe('partial failure');

			const noError = compactToolResultForLlm('answer_question', {
				answer: 'Short answer'
			}) as Record<string, unknown>;
			expect(noError.citationCount).toBe(0);
			expect(noError.answer).toBe('Short answer');
			expect(noError).not.toHaveProperty('error');

			const blankError = compactToolResultForLlm('answer_question', {
				answer: 'ok',
				error: '   '
			}) as Record<string, unknown>;
			expect(blankError).not.toHaveProperty('error');

			const nonStringAnswer = compactToolResultForLlm('answer_question', {
				answer: 42,
				citations: 'not-array'
			}) as Record<string, unknown>;
			expect(nonStringAnswer.answer).toBeUndefined();
			expect(nonStringAnswer.citationCount).toBe(0);
		});
	});

	describe('formatToolResultForAgentMessage', () => {
		it('returns compact JSON without truncation for small payloads', () => {
			const message = formatToolResultForAgentMessage('capture_thought', {
				thoughtId: 't1',
				thought: { id: 't1', normalizedText: 'hi' }
			});
			expect(message.length).toBeLessThan(MAX_TOOL_RESULT_JSON_CHARS);
			expect(message).not.toContain('truncated');
			expect(message).toContain('"thoughtId": "t1"');
		});

		it('caps oversized agent message JSON and strips embeddings', () => {
			const results = Array.from({ length: 50 }, (_, i) => ({
				id: `t-${i}`,
				normalizedText: 'x'.repeat(500),
				category: 'thought',
				score: maxFusedRrfScore(CONTEXT_WEIGHTS.default),
				metadata: { graph: { nodes: Array.from({ length: 20 }, () => 'n') } }
			}));
			const agentMessage = formatToolResultForAgentMessage('retrieve_thoughts', { results });
			expect(agentMessage.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_JSON_CHARS);
			expect(agentMessage).not.toContain('"metadata"');
			expect(agentMessage).toContain('"truncated": true');
		});

		it('applies capJsonString suffix when compact JSON exceeds max chars', () => {
			const message = formatToolResultForAgentMessage('custom_tool', {
				blob: 'z'.repeat(20_000)
			});
			expect(message.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_JSON_CHARS);
			expect(message).toMatch(/…\[truncated \d+ chars\]$/);
		});
	});

	describe('formatToolResultPreview', () => {
		it('returns compact single-line JSON for small payloads', () => {
			const preview = formatToolResultPreview('list_thoughts', {
				thoughts: [{ id: 't1', normalizedText: 'Hello' }]
			});
			expect(preview.length).toBeLessThan(MAX_TOOL_RESULT_PREVIEW_CHARS);
			expect(preview).not.toContain('\n');
			expect(preview).not.toMatch(/…\[truncated \d+ chars\]/);
		});

		it('keeps retrieved thoughts in answer_question UI previews', () => {
			const preview = formatToolResultPreview('answer_question', {
				answer: 'Answer: Home office. [<id=t1>]\nEvidence:\n- Working from home [t1]\nUnknown:\n- none',
				citations: ['t1'],
				retrieved: [{ id: 't1', normalizedText: 'Ich arbeite heute von zu Hause aus.', category: 'thought' }]
			});
			const parsed = JSON.parse(preview) as {
				answer?: string;
				retrieved?: Array<{ id: string; snippet: string; category: string }>;
			};
			expect(parsed.retrieved).toEqual([
				{ id: 't1', snippet: 'Ich arbeite heute von zu Hause aus.', category: 'thought' }
			]);
			expect(parsed.answer).toContain('Evidence:');
		});

		it('truncates oversized preview JSON via capJsonString', () => {
			const preview = formatToolResultPreview('custom_tool', {
				blob: 'z'.repeat(15_000)
			});
			expect(preview.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_PREVIEW_CHARS);
			expect(preview).toMatch(/…\[truncated \d+ chars\]$/);
		});
	});
});
