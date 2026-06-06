import { describe, expect, it } from 'vitest';
import { evidenceHitsFromAnswerQuestionPayload, parseFinalAnswerText } from './chat-stream-types';
import {
	compactChatIntermediateSteps,
	normalizeChatDisplay,
	sessionMessagesToChatEntries,
	shouldSkipDuplicateFinalAnswer
} from './normalize-messages';

describe('normalizeChatDisplay', () => {
	it('merges tool_call and tool_result into one card', () => {
		const out = normalizeChatDisplay([
			{ role: 'user', content: 'hi' },
			{
				role: 'assistant',
				variant: 'tool_call',
				tool: 'answer_question',
				arguments: { question: 'hi' }
			},
			{
				role: 'assistant',
				variant: 'tool_result',
				tool: 'answer_question',
				content: 'Answer: ok',
				status: 'success'
			}
		]);
		expect(out).toHaveLength(2);
		expect(out[1]).toMatchObject({
			variant: 'tool_call',
			tool: 'answer_question',
			status: 'done',
			result: 'Answer: ok'
		});
	});

	it('drops duplicate final text after answer_question tool card', () => {
		const out = normalizeChatDisplay([
			{
				role: 'assistant',
				variant: 'tool_call',
				tool: 'answer_question',
				arguments: {},
				status: 'done',
				result: 'Answer: Not in memory.'
			},
			{ role: 'assistant', variant: 'text', content: 'Answer: Not in memory.' }
		]);
		expect(out).toHaveLength(1);
	});

	it('keeps final text when it differs from answer_question tool card result', () => {
		const out = normalizeChatDisplay([
			{
				role: 'assistant',
				variant: 'tool_call',
				tool: 'answer_question',
				arguments: {},
				status: 'done',
				result: 'reference\nAnnie ist meine Schwester'
			},
			{
				role: 'assistant',
				variant: 'text',
				content: 'Annie ist deine Schwester.'
			}
		]);
		expect(out).toHaveLength(2);
		expect(out[1]).toMatchObject({
			role: 'assistant',
			variant: 'text',
			content: 'Annie ist deine Schwester.'
		});
	});

	it('dedupes consecutive identical answer_question cards', () => {
		const out = normalizeChatDisplay([
			{
				role: 'assistant',
				variant: 'tool_call',
				tool: 'answer_question',
				arguments: {},
				status: 'done',
				result: 'Answer: x'
			},
			{
				role: 'assistant',
				variant: 'tool_call',
				tool: 'answer_question',
				arguments: {},
				status: 'done',
				result: 'Answer: x'
			}
		]);
		expect(out).toHaveLength(1);
	});

	it('drops duplicate final text after answer_question timeline tool_result', () => {
		const preview = JSON.stringify({
			answer:
				'Answer: To cook salmon, whisk miso glaze and broil. [salmon-id]\nEvidence:\n- Recipe steps [salmon-id]\nUnknown:\n- none'
		});
		const out = normalizeChatDisplay([
			{
				role: 'assistant',
				variant: 'timeline',
				kind: 'tool_result',
				tool: 'answer_question',
				label: 'Tool result · answer_question',
				content: preview
			},
			{
				role: 'assistant',
				variant: 'text',
				content: 'To cook salmon, whisk miso glaze and broil. [salmon-id]'
			}
		]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ variant: 'timeline', kind: 'tool_result', tool: 'answer_question' });
	});
});

describe('sessionMessagesToChatEntries', () => {
	it('maps persisted tool rows to timeline entries like the live stream', () => {
		const out = sessionMessagesToChatEntries([
			{ role: 'user', content: 'hi' },
			{
				role: 'assistant',
				content: '{"tool":"retrieve_thoughts"}',
				metadata: {
					variant: 'tool_call',
					tool: 'retrieve_thoughts',
					arguments: { query: 'coffee' }
				}
			},
			{
				role: 'assistant',
				content: 'retrieve_thoughts',
				metadata: { variant: 'tool_executing', tool: 'retrieve_thoughts' }
			},
			{
				role: 'assistant',
				content: 'Searching your memories…',
				metadata: {
					variant: 'tool_progress',
					tool: 'retrieve_thoughts',
					label: 'Searching your memories…'
				}
			},
			{
				role: 'assistant',
				content: '{"results":[]}',
				metadata: { variant: 'tool_result', tool: 'retrieve_thoughts' }
			},
			{ role: 'assistant', content: 'You like coffee.' }
		]);
		expect(out.filter((e) => e.role === 'assistant' && e.variant === 'timeline')).toHaveLength(4);
		expect(out.at(-1)).toMatchObject({ variant: 'text', content: 'You like coffee.' });
	});

	it('keeps raw answer_question JSON for evidence cards, not displaySummary alone', () => {
		const preview = JSON.stringify({
			answer:
				'Answer: Annie ist deine Schwester. [t1]\nEvidence:\n- Annie ist meine Schwester [t1]\nUnknown:\n- none',
			retrieved: [{ id: 't1', normalizedText: 'Annie ist meine Schwester', category: 'reference' }]
		});
		const out = sessionMessagesToChatEntries([
			{
				role: 'assistant',
				content: preview,
				metadata: {
					variant: 'tool_result',
					tool: 'answer_question',
					displaySummary: 'Answer: Annie ist deine Schwester.'
				}
			}
		]);
		const step = out.find(
			(e) => e.role === 'assistant' && e.variant === 'timeline' && e.kind === 'tool_result'
		);
		expect(step && step.variant === 'timeline' && step.content).toBe(preview);
		expect(evidenceHitsFromAnswerQuestionPayload(preview).length).toBeGreaterThan(0);
	});

	it('expands tool_step with raw JSON payload for evidence on reload', () => {
		const preview = JSON.stringify({
			answer: 'Answer: ok',
			retrieved: [{ id: 'a', normalizedText: 'memory hit', category: 'thought' }]
		});
		const out = sessionMessagesToChatEntries([
			{
				role: 'assistant',
				content: preview,
				metadata: {
					variant: 'tool_step',
					tool: 'answer_question',
					arguments: { question: 'q' },
					displaySummary: 'Answer: ok'
				}
			}
		]);
		const result = out.find(
			(e) => e.role === 'assistant' && e.variant === 'timeline' && e.kind === 'tool_result'
		);
		expect(result && result.variant === 'timeline' && result.content).toBe(preview);
		expect(evidenceHitsFromAnswerQuestionPayload(preview).length).toBe(0);
	});

	it('tool_step answer_question reload yields parseable answer prose from preview JSON', () => {
		const preview = JSON.stringify({
			answer:
				'Answer: To cook Japanese-Glazed Salmon, whisk a miso glaze and broil. [salmon-id]\nEvidence:\n- Recipe [salmon-id]\nUnknown:\n- none',
			citations: ['salmon-id'],
			retrieved: [
				{
					id: 'salmon-id',
					normalizedText: 'Recipe: Japanese Miso-Glazed Salmon.',
					category: 'observation'
				}
			]
		});
		const out = sessionMessagesToChatEntries([
			{
				role: 'assistant',
				content: preview,
				metadata: {
					variant: 'tool_step',
					tool: 'answer_question',
					arguments: { question: 'Wie koche ich Japanese-Glazed Salmon?' }
				}
			}
		]);
		const result = out.find(
			(e) => e.role === 'assistant' && e.variant === 'timeline' && e.kind === 'tool_result'
		);
		expect(result && result.variant === 'timeline' && result.content).toBe(preview);
		expect(parseFinalAnswerText('', preview)).toBe(
			'To cook Japanese-Glazed Salmon, whisk a miso glaze and broil. [salmon-id]'
		);
	});

	it('expands tool_step into call / executing / result timeline rows', () => {
		const out = sessionMessagesToChatEntries([
			{
				role: 'assistant',
				content: '{"results":[]}',
				metadata: {
					variant: 'tool_step',
					tool: 'retrieve_thoughts',
					arguments: { query: 'x' }
				}
			}
		]);
		expect(out).toHaveLength(3);
		expect(out.map((e) => (e.role === 'assistant' && e.variant === 'timeline' ? e.kind : null))).toEqual([
			'tool_call',
			'tool_executing',
			'tool_result'
		]);
	});
});

describe('compactChatIntermediateSteps', () => {
	it('combines tool_call and tool_result into tool_step', () => {
		const out = compactChatIntermediateSteps([
			{
				content: '{"tool":"answer_question"}',
				metadata: { variant: 'tool_call', tool: 'answer_question', arguments: { question: 'q' } }
			},
			{
				content: '{"answer":"a"}',
				metadata: {
					variant: 'tool_result',
					tool: 'answer_question',
					displaySummary: 'Answer: a'
				}
			}
		]);
		expect(out).toHaveLength(1);
		expect(out[0].metadata.variant).toBe('tool_step');
		expect(out[0].metadata.tool).toBe('answer_question');
	});

	it('shouldSkipDuplicateFinalAnswer when tool_step present', () => {
		const steps = compactChatIntermediateSteps([
			{
				content: '{}',
				metadata: { variant: 'tool_call', tool: 'answer_question', arguments: {} }
			},
			{
				content: '{}',
				metadata: { variant: 'tool_result', tool: 'answer_question', displaySummary: 'Answer: a' }
			}
		]);
		expect(shouldSkipDuplicateFinalAnswer(steps)).toBe(true);
	});
});
