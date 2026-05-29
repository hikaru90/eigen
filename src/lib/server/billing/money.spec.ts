import { describe, expect, it } from 'vitest';
import {
	baseUsdToBilledCents,
	baseUsdToTotalMicroUsd,
	centsToPayPalAmountValue,
	microUsdToWholeCents,
	MICRO_USD_PER_CENT,
	normalizeCurrencyCode,
	usdStringToCents
} from './money';

describe('billing money', () => {
	it('converts priced USD strings to cents with nearest-cent rounding', () => {
		expect(usdStringToCents('1.200000')).toBe(120);
		expect(usdStringToCents('0.000100')).toBe(0);
		expect(usdStringToCents('0.005000')).toBe(1);
	});

	it('applies markup when converting base USD to billed cents', () => {
		expect(baseUsdToBilledCents(1)).toBe(120);
	});

	it('accumulates sub-cent totals in micro-USD', () => {
		const micro = baseUsdToTotalMicroUsd(0.0001);
		expect(micro).toBeGreaterThan(0);
		expect(micro).toBeLessThan(MICRO_USD_PER_CENT);
		expect(microUsdToWholeCents(micro)).toBe(0);
		expect(microUsdToWholeCents(MICRO_USD_PER_CENT - 1)).toBe(0);
		expect(microUsdToWholeCents(MICRO_USD_PER_CENT)).toBe(1);
	});

	it('normalizes supported currency codes', () => {
		expect(normalizeCurrencyCode('eur')).toBe('EUR');
	});

	it('formats PayPal amount values', () => {
		expect(centsToPayPalAmountValue(1050)).toBe('10.50');
	});
});
