import { describe, expect, it } from 'vitest';
import { validateNonEmptyEntityId, validateSearchParams } from './mcp-args';

describe('validateNonEmptyEntityId', () => {
	it('returns trimmed id', () => {
		expect(validateNonEmptyEntityId('  u1  ', 'user_id')).toBe('u1');
	});

	it('rejects empty', () => {
		expect(() => validateNonEmptyEntityId('   ', 'user_id')).toThrow(/whitespace-only/);
	});

	it('rejects interior whitespace', () => {
		expect(() => validateNonEmptyEntityId('a b', 'user_id')).toThrow(/whitespace/);
	});
});

describe('validateSearchParams', () => {
	it('accepts valid bounds', () => {
		expect(() => validateSearchParams({ threshold: 0.5, topK: 10 })).not.toThrow();
	});

	it('rejects threshold out of range', () => {
		expect(() => validateSearchParams({ threshold: 1.1 })).toThrow(/threshold/);
	});

	it('rejects negative topK', () => {
		expect(() => validateSearchParams({ topK: -1 })).toThrow(/top_k/);
	});
});
