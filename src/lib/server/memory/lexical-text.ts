import { foldLexicalChars } from './lexical-fold';

/**
 * Precomputed text for lexical / full-text recall (names, codes, short phrases).
 * English lemmatization or stemming can be layered later; keep this deterministic.
 */
export function computeLexicalText(source: string): string {
	const folded = foldLexicalChars(source).trim();
	return folded.replace(/\s+/g, ' ');
}
