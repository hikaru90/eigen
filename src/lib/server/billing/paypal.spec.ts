import { describe, expect, it } from 'vitest';
import { parsePayPalCaptureBreakdownForTest } from './paypal';

describe('PayPal capture breakdown parsing', () => {
	it('parses gross, fee, and net from seller_receivable_breakdown', () => {
		const result = parsePayPalCaptureBreakdownForTest({
			amount: { currency_code: 'USD', value: '1.75' },
			seller_receivable_breakdown: {
				gross_amount: { currency_code: 'USD', value: '1.75' },
				paypal_fee: { currency_code: 'USD', value: '0.54' },
				net_amount: { currency_code: 'USD', value: '1.21' }
			}
		});
		expect(result).toEqual({
			grossUsd: '1.75',
			paypalFeeUsd: '0.54',
			netUsd: '1.21'
		});
	});

	it('throws when fee breakdown is missing', () => {
		expect(() =>
			parsePayPalCaptureBreakdownForTest({
				amount: { currency_code: 'USD', value: '1.75' }
			})
		).toThrow(/paypal_fee/);
	});

	it('throws when currency is not USD', () => {
		expect(() =>
			parsePayPalCaptureBreakdownForTest({
				amount: { currency_code: 'EUR', value: '1.75' },
				seller_receivable_breakdown: {
					paypal_fee: { currency_code: 'EUR', value: '0.54' },
					net_amount: { currency_code: 'EUR', value: '1.21' }
				}
			})
		).toThrow(/USD/);
	});
});
