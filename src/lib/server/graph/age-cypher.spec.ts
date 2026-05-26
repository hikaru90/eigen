import { describe, expect, it } from 'vitest';
import { wrapAgeCypherDollarQuote } from './age-cypher';

describe('wrapAgeCypherDollarQuote', () => {
	it('wraps cypher in $$ delimiters', () => {
		expect(wrapAgeCypherDollarQuote("MATCH (n) RETURN n")).toBe('$$MATCH (n) RETURN n$$');
	});

	it('uses a tagged delimiter when the query contains $$', () => {
		expect(wrapAgeCypherDollarQuote('RETURN $$')).toBe('$age_cypher$RETURN $$$age_cypher$');
	});
});
