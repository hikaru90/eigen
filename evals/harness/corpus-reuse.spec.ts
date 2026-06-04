import { describe, expect, it } from 'vitest';
import { evalCorpusUserId } from './eval-config';
import { parseEvalCliArgs, shouldReuseCorpusCapture } from './corpus-reuse';

describe('evalCorpusUserId', () => {
	it('returns a stable corpus tenant per operator', () => {
		expect(evalCorpusUserId('eval-runner-operator')).toBe('eval-corpus-eval-runner-operator');
		expect(evalCorpusUserId('user_abc')).toBe('eval-corpus-user_abc');
	});
});

describe('shouldReuseCorpusCapture', () => {
	it('reuses when stored rawText matches expected (trimmed)', () => {
		expect(
			shouldReuseCorpusCapture({
				expectedRawText: '  Marcus is allergic to walnuts. ',
				storedRawText: 'Marcus is allergic to walnuts.'
			})
		).toBe(true);
	});

	it('does not reuse when stored text is missing', () => {
		expect(
			shouldReuseCorpusCapture({
				expectedRawText: 'Marcus is allergic to walnuts.',
				storedRawText: null
			})
		).toBe(false);
	});

	it('does not reuse when catalog text changed', () => {
		expect(
			shouldReuseCorpusCapture({
				expectedRawText: 'Marcus is allergic to walnuts.',
				storedRawText: 'Marcus is allergic to peanuts.'
			})
		).toBe(false);
	});
});

describe('parseEvalCliArgs', () => {
	it('defaults to smoke without fresh corpus', () => {
		expect(parseEvalCliArgs([])).toEqual({ mode: 'smoke', qaId: undefined, freshCorpus: false });
	});

	it('parses mode, qa id, and fresh corpus flag', () => {
		expect(
			parseEvalCliArgs(['--mode', 'qa', '--qa-id', 'qa_smoke_dinner', '--fresh-corpus'])
		).toEqual({
			mode: 'qa',
			qaId: 'qa_smoke_dinner',
			freshCorpus: true
		});
	});

	it('throws on invalid mode', () => {
		expect(() => parseEvalCliArgs(['--mode', 'invalid'])).toThrow(
			'--mode must be smoke, all, or qa'
		);
	});
});
