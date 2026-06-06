import { describe, expect, it } from 'vitest';
import {
	corpusUserIdForQuestion,
	formatSessionAsCapture,
	formatTurnAsCapture,
	instanceToCaptureItems,
	sanitizeQuestionIdForUserId
} from '../longmemeval/format-session';
import type { LongMemEvalInstance } from '../longmemeval/types';

describe('formatSessionAsCapture', () => {
	it('formats turns with session date and id', () => {
		const text = formatSessionAsCapture('2023-03-15', 'sess_1', [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there' }
		]);
		expect(text).toContain('Chat session (sess_1) on 2023-03-15');
		expect(text).toContain('User: Hello');
		expect(text).toContain('Assistant: Hi there');
	});
});

describe('instanceToCaptureItems', () => {
	it('maps each haystack session to one capture item', () => {
		const instance: LongMemEvalInstance = {
			question_id: 'q1',
			question_type: 'single-session-user',
			question: 'Q?',
			answer: 'A',
			question_date: '2023-04-01',
			haystack_dates: ['2023-03-01'],
			haystack_session_ids: ['s1'],
			haystack_sessions: [[{ role: 'user', content: 'fact' }]]
		};
		expect(instanceToCaptureItems(instance, 'session')).toEqual([
			{ id: 's1', rawText: expect.stringContaining('User: fact') }
		]);
	});

	it('defaults to user-turn captures', () => {
		const instance: LongMemEvalInstance = {
			question_id: 'q1',
			question_type: 'single-session-user',
			question: 'Q?',
			answer: 'A',
			question_date: '2023-04-01',
			haystack_dates: ['2023-03-01'],
			haystack_session_ids: ['s1'],
			haystack_sessions: [
				[
					{ role: 'user', content: 'fact' },
					{ role: 'assistant', content: 'ok' }
				]
			]
		};
		expect(instanceToCaptureItems(instance)).toEqual([
			{ id: 's1_1', rawText: formatTurnAsCapture('2023-03-01', 's1', { role: 'user', content: 'fact' }) }
		]);
	});
});

describe('sanitizeQuestionIdForUserId', () => {
	it('strips unsafe characters', () => {
		expect(sanitizeQuestionIdForUserId('gpt4_2655b836')).toBe('gpt4_2655b836');
		expect(corpusUserIdForQuestion('gpt4/2655')).toBe('longmemeval-corpus-gpt4_2655');
	});
});
