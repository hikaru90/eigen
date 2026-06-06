import { describe, expect, it } from 'vitest';
import { parseOptionalIsoTimestamp } from './parse-iso';

describe('parseOptionalIsoTimestamp', () => {
	it('returns undefined for empty values', () => {
		expect(parseOptionalIsoTimestamp(undefined, 'captured_at')).toBeUndefined();
		expect(parseOptionalIsoTimestamp('', 'captured_at')).toBeUndefined();
	});

	it('parses valid ISO timestamps', () => {
		const parsed = parseOptionalIsoTimestamp('2023-03-15T12:00:00.000Z', 'captured_at');
		expect(parsed?.toISOString()).toBe('2023-03-15T12:00:00.000Z');
	});

	it('throws on invalid input', () => {
		expect(() => parseOptionalIsoTimestamp('not-a-date', 'captured_at')).toThrow(/not a valid ISO-8601/);
		expect(() => parseOptionalIsoTimestamp(123, 'captured_at')).toThrow(/must be an ISO-8601 string/);
	});
});
