/**
 * Deterministic folding for lexical tokenization (query + stored `lexical_text`).
 * NFKC → lowercase → ß→ss → strip combining marks so German umlauts and ß
 * tokenize consistently with ASCII `to_tsquery('simple', ...)`.
 */
export function foldLexicalChars(source: string): string {
	return source
		.normalize('NFKC')
		.toLowerCase()
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/\p{M}/gu, '');
}

/** Alphanumeric tokens after folding; deduped in source order. */
export function tokenizeLexicalQuery(query: string): string[] {
	return foldLexicalChars(query)
		.split(/[^a-z0-9]+/g)
		.map((token) => token.trim())
		.filter((token, index, arr) => token.length > 0 && arr.indexOf(token) === index);
}
