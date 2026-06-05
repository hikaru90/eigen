import { describe, expect, it } from 'vitest';
import { foldLexicalChars, tokenizeLexicalQuery } from './lexical-fold';

describe('foldLexicalChars', () => {
	it('folds German umlauts and eszett', () => {
		expect(foldLexicalChars('über Weißt')).toBe('uber weisst');
	});

	it('applies NFKC before folding', () => {
		expect(foldLexicalChars('\u2126')).toBe('\u03c9');
	});
});

describe('tokenizeLexicalQuery', () => {
	it('tokenizes German questions without splitting umlaut letters', () => {
		expect(tokenizeLexicalQuery('was weißt du über mich?')).toEqual([
			'was',
			'weisst',
			'du',
			'uber',
			'mich'
		]);
	});
});
