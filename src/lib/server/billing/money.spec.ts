import { describe, expect, it } from 'vitest';
import {
	baseUsdToBilledCents,
	centsToPayPalAmountValue,
	normalizeCurrencyCode,
	usdStringToCents
} from './money';

describe('billing money', () => {
	it('converts priced USD strings to cents rounded up', () => {
		expect(usdStringToCents('1.200000')).toBe(120);
		expect(usdStringToCents('0.000100')).toBe(1);
	});

	it('applies markup when converting base USD to billed cents', () => {
		expect(baseUsdToBilledCents(1)).toBe(120);
	});

	it('normalizes supported currency codes', () => {
		expect(normalizeCurrencyCode('eur')).toBe('EUR');
	});

	it('formats PayPal amount values', () => {
		expect(centsToPayPalAmountValue(1050)).toBe('10.50');
	});
});
