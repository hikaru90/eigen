import { describe, expect, it } from 'vitest';
import {
	compactChatIntermediateSteps,
	normalizeChatDisplay,
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
