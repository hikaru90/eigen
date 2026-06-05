import { describe, expect, it } from 'vitest';
import { computeLexicalText } from './lexical-text';

describe('computeLexicalText', () => {
	it('folds case and collapses whitespace', () => {
		expect(computeLexicalText('  Foo   BAR  ')).toBe('foo bar');
	});

	it('applies NFKC normalization', () => {
		expect(computeLexicalText('\u2126')).toBe('\u03c9');
	});

	it('folds German umlauts and eszett for lexical recall', () => {
		expect(computeLexicalText('Über Weißbrot')).toBe('uber weissbrot');
	});
});
