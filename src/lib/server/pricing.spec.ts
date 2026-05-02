import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKUP_RATE, priceCall } from './pricing';

describe('priceCall', () => {
	it('applies default 20% markup (AC-014)', () => {
		const p = priceCall(1.0);
		expect(p.baseCostUsd).toBe('1.000000');
		expect(p.markupUsd).toBe((1.0 * DEFAULT_MARKUP_RATE).toFixed(6));
		expect(p.totalCostUsd).toBe('1.200000');
		expect(p.markupRate).toBe(DEFAULT_MARKUP_RATE.toFixed(6));
	});

	it('rejects negative base', () => {
		expect(() => priceCall(-0.01)).toThrow();
	});
});
