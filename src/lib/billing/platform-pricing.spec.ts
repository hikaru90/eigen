import { describe, expect, it } from 'vitest';
import {
	computeTopUpCheckoutUi,
	formatActivityCredits,
	formatActivityCreditsSum,
	formatCreditsAsUsd,
	formatUsdAmount,
	platformMarkupPercentLabel,
	purchaseMarkupDisclosureText,
	totalCostUsdToCredits
} from './platform-pricing';

describe('platform-pricing', () => {
	it('purchase disclosure mentions markup at purchase and usage', () => {
		expect(platformMarkupPercentLabel()).toBe('20%');
		expect(purchaseMarkupDisclosureText()).toContain('20%');
		expect(purchaseMarkupDisclosureText()).toContain('PayPal');
	});

	it('quotes checkout with markup and PayPal fee from shared computeTopUpCheckoutUi', () => {
		const quote = computeTopUpCheckoutUi(1000);
		expect(quote).not.toBeNull();
		expect(quote!.baseUsd).toBe(1);
		expect(quote!.markupUsd).toBe(0.2);
		expect(quote!.platformSubtotalUsd).toBe(1.2);
		expect(quote!.totalDueUsd).toBe(1.75);
		expect(quote!.paypalFeeUsd).toBe(0.54);
	});

	it('converts totalCostUsd to credits including markup', () => {
		expect(totalCostUsdToCredits('0.002400')).toBe(2.4);
		expect(totalCostUsdToCredits('1.200000')).toBe(1200);
	});

	it('formats sub-credit amounts without rounding to zero', () => {
		expect(formatActivityCredits('0.000500')).toBe('0.5');
		expect(formatActivityCredits('0.002400')).toBe('2.4');
	});

	it('formats whole credits with grouping', () => {
		expect(formatActivityCredits('1.200000')).toBe('1,200');
	});

	it('sums multiple calls for gateway-agnostic display', () => {
		expect(formatActivityCreditsSum(['0.001200', '0.002400'])).toBe('3.6');
	});

	it('formats credits as USD for balance display', () => {
		expect(formatCreditsAsUsd(1000)).toBe('$1.00');
		expect(formatCreditsAsUsd(10000)).toBe('$10.00');
		expect(formatCreditsAsUsd(0)).toBe('$0.00');
		expect(formatCreditsAsUsd(-1)).toBeNull();
	});

	it('formats USD amounts for checkout lines', () => {
		expect(formatUsdAmount(1.75)).toBe('$1.75');
	});
});
