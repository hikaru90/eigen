import { describe, expect, it } from 'vitest';
import { billedMicroUsdFromBaseUsd } from './usage-gate';
import { MICRO_USD_PER_CENT } from './money';

describe('usage-gate billing', () => {
	it('accumulates sub-cent settled costs instead of rounding up to 1 cent', () => {
		const micro = billedMicroUsdFromBaseUsd(0.0001);
		expect(micro).toBeGreaterThan(0);
		expect(micro).toBeLessThan(MICRO_USD_PER_CENT);
	});

	it('returns 0 micro-USD for zero base cost', () => {
		expect(billedMicroUsdFromBaseUsd(0)).toBe(0);
	});
});
