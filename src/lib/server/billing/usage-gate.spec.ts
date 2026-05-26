import { describe, expect, it } from 'vitest';
import { estimateChatBilledCents, billedCentsFromBaseUsd } from './usage-gate';

describe('usage-gate estimates', () => {
	it('returns at least 1 cent for chat estimates', () => {
		expect(estimateChatBilledCents([{ role: 'user', content: 'hi' }])).toBeGreaterThanOrEqual(1);
	});

	it('returns 0 billed cents for zero base cost', () => {
		expect(billedCentsFromBaseUsd(0)).toBe(0);
	});
});
