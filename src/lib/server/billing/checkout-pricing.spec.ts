import { describe, expect, it } from 'vitest';
import {
	CHECKOUT_GROSS_TOLERANCE_CENTS,
	computeTopUpCheckout,
	estimatedPaypalFeeUsd,
	getPayPalFeeConfig,
	grossUsdForTargetNetUsd,
	netCoversPlatformSubtotal,
	usdStringsMatchWithinTolerance
} from './checkout-pricing';

const US_FEES = { fixedUsd: 0.49, rate: 0.029 };

describe('checkout-pricing', () => {
	it('grosses up subtotal to cover PayPal fixed + variable fees', () => {
		const gross = grossUsdForTargetNetUsd(1.2, US_FEES);
		expect(gross).toBe(1.75);
		const fee = estimatedPaypalFeeUsd(gross, US_FEES);
		expect(gross - fee).toBeGreaterThanOrEqual(1.2 - 0.01);
	});

	it('quotes gross checkout for 1000 credits with 20% markup and US fees', () => {
		const quote = computeTopUpCheckout(1000, US_FEES);
		expect(quote.baseUsd).toBe('1.000000');
		expect(quote.markupUsd).toBe('0.200000');
		expect(quote.platformSubtotalUsd).toBe('1.200000');
		expect(quote.grossUsd).toBe('1.75');
		expect(quote.grossPayPalValue).toBe('1.75');
		expect(quote.estimatedPaypalFeeUsd).toBe('0.54');
		const net = Number(quote.grossUsd) - Number(quote.estimatedPaypalFeeUsd);
		expect(net).toBeGreaterThanOrEqual(1.2);
	});

	it('scales quote for larger top-ups', () => {
		const quote = computeTopUpCheckout(10_000, US_FEES);
		expect(quote.platformSubtotalUsd).toBe('12.000000');
		expect(quote.grossPayPalValue).toBe('12.87');
	});

	it('matches USD strings within cent tolerance', () => {
		expect(usdStringsMatchWithinTolerance('1.74', '1.74')).toBe(true);
		expect(usdStringsMatchWithinTolerance('1.74', '1.735', CHECKOUT_GROSS_TOLERANCE_CENTS)).toBe(
			true
		);
		expect(usdStringsMatchWithinTolerance('1.74', '1.72', CHECKOUT_GROSS_TOLERANCE_CENTS)).toBe(
			false
		);
	});

	it('validates net covers platform subtotal', () => {
		expect(netCoversPlatformSubtotal('1.20', '1.200000')).toBe(true);
		expect(netCoversPlatformSubtotal('1.19', '1.200000')).toBe(true);
		expect(netCoversPlatformSubtotal('1.18', '1.200000')).toBe(false);
	});

	it('uses default fee config when env unset', () => {
		const config = getPayPalFeeConfig();
		expect(config.fixedUsd).toBe(0.49);
		expect(config.rate).toBe(0.029);
	});
});
