import { env } from '$env/dynamic/private';
import { MIN_TOP_UP_CREDITS } from '$lib/server/billing/credits';
import { centsToPayPalAmountValue, usdStringToCents } from '$lib/server/billing/money';
import { DEFAULT_MARKUP_RATE, priceCall } from '$lib/server/pricing';

/** Default US PayPal fixed fee per transaction (USD). Override via PAYPAL_FEE_FIXED_USD. */
export const DEFAULT_PAYPAL_FEE_FIXED_USD = 0.49;

/** Default PayPal variable fee rate (e.g. 0.029 = 2.9%). Override via PAYPAL_FEE_RATE. */
export const DEFAULT_PAYPAL_FEE_RATE = 0.029;

/** Cent-level tolerance when comparing PayPal gross to quoted checkout. */
export const CHECKOUT_GROSS_TOLERANCE_CENTS = 1;

/** Cent-level tolerance when verifying operator net vs quoted platform subtotal. */
export const CHECKOUT_NET_TOLERANCE_CENTS = 1;

export type TopUpCheckoutQuote = {
	credits: number;
	baseUsd: string;
	markupUsd: string;
	platformSubtotalUsd: string;
	estimatedPaypalFeeUsd: string;
	grossUsd: string;
	grossPayPalValue: string;
};

export type PayPalFeeConfig = {
	fixedUsd: number;
	rate: number;
};

function parseFeeEnv(raw: string | undefined, label: string): number | null {
	if (raw === undefined || raw.trim() === '') return null;
	const parsed = Number(raw.trim());
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error(`${label} must be a non-negative finite number`);
	}
	return parsed;
}

/** Resolve PayPal fee constants from env (with US defaults). */
export function getPayPalFeeConfig(): PayPalFeeConfig {
	const fixedUsd =
		parseFeeEnv(env.PAYPAL_FEE_FIXED_USD, 'PAYPAL_FEE_FIXED_USD') ?? DEFAULT_PAYPAL_FEE_FIXED_USD;
	const rate = parseFeeEnv(env.PAYPAL_FEE_RATE, 'PAYPAL_FEE_RATE') ?? DEFAULT_PAYPAL_FEE_RATE;
	if (rate >= 1) {
		throw new Error('PAYPAL_FEE_RATE must be less than 1');
	}
	return { fixedUsd, rate };
}

/**
 * Gross USD charged at PayPal so operator net covers platform subtotal after fees.
 * net = gross - (fixed + rate * gross) >= subtotal  =>  gross = (subtotal + fixed) / (1 - rate)
 */
export function grossUsdForTargetNetUsd(subtotalUsd: number, fees: PayPalFeeConfig): number {
	if (subtotalUsd <= 0) return 0;
	const gross = (subtotalUsd + fees.fixedUsd) / (1 - fees.rate);
	return Math.ceil(gross * 100) / 100;
}

export function estimatedPaypalFeeUsd(grossUsd: number, fees: PayPalFeeConfig): number {
	if (grossUsd <= 0) return 0;
	const fee = fees.fixedUsd + fees.rate * grossUsd;
	return Math.round(fee * 100) / 100;
}

/** Full checkout quote for a credit top-up (markup + PayPal gross-up). */
export function computeTopUpCheckout(
	credits: number,
	fees: PayPalFeeConfig = getPayPalFeeConfig(),
	markupRate: number = DEFAULT_MARKUP_RATE
): TopUpCheckoutQuote {
	if (!Number.isInteger(credits) || credits < MIN_TOP_UP_CREDITS) {
		throw new Error(`credits must be an integer of at least ${MIN_TOP_UP_CREDITS}`);
	}

	const baseUsd = credits / 1000;
	const priced = priceCall(baseUsd, markupRate);
	const platformSubtotalUsd = Number(priced.totalCostUsd);
	const grossUsd = grossUsdForTargetNetUsd(platformSubtotalUsd, fees);
	const grossCents = usdStringToCents(grossUsd.toFixed(6));
	const feeUsd = estimatedPaypalFeeUsd(grossUsd, fees);

	return {
		credits,
		baseUsd: priced.baseCostUsd,
		markupUsd: priced.markupUsd,
		platformSubtotalUsd: priced.totalCostUsd,
		estimatedPaypalFeeUsd: feeUsd.toFixed(2),
		grossUsd: grossUsd.toFixed(2),
		grossPayPalValue: centsToPayPalAmountValue(grossCents)
	};
}

/** Compare two USD decimal strings at cent precision. */
export function usdStringsMatchWithinTolerance(
	a: string,
	b: string,
	toleranceCents = CHECKOUT_GROSS_TOLERANCE_CENTS
): boolean {
	return Math.abs(usdStringToCents(a) - usdStringToCents(b)) <= toleranceCents;
}

/** True when captured net covers quoted platform subtotal within tolerance. */
export function netCoversPlatformSubtotal(
	netUsd: string,
	platformSubtotalUsd: string,
	toleranceCents = CHECKOUT_NET_TOLERANCE_CENTS
): boolean {
	return usdStringToCents(netUsd) + toleranceCents >= usdStringToCents(platformSubtotalUsd);
}
