/** Eigen platform credits per one US dollar (matches server CREDITS_PER_USD). */
export const CREDITS_PER_USD = 1000;

/** Minimum PayPal top-up (matches server MIN_TOP_UP_CREDITS). */
export const MIN_TOP_UP_CREDITS = 1000;

/** Default platform markup on gateway usage (matches server DEFAULT_MARKUP_RATE). */
export const PLATFORM_MARKUP_RATE = 0.2;

/** Default US PayPal fixed fee (matches server DEFAULT_PAYPAL_FEE_FIXED_USD). */
export const DEFAULT_PAYPAL_FEE_FIXED_USD = 0.49;

/** Default PayPal variable fee rate (matches server DEFAULT_PAYPAL_FEE_RATE). */
export const DEFAULT_PAYPAL_FEE_RATE = 0.029;

export type TopUpCheckoutQuoteUi = {
	credits: number;
	baseUsd: number;
	markupUsd: number;
	platformSubtotalUsd: number;
	estimatedPaypalFeeUsd: number;
	grossUsd: number;
};

export function platformMarkupPercentLabel(): string {
	return `${Math.round(PLATFORM_MARKUP_RATE * 100)}%`;
}

/** Shown at credit purchase only — not in Activity. */
export function purchaseMarkupDisclosureText(): string {
	return `Top-ups include a ${platformMarkupPercentLabel()} platform fee plus estimated PayPal processing fees in the checkout total. Usage also debits your wallet at gateway rates plus ${platformMarkupPercentLabel()}. ${CREDITS_PER_USD.toLocaleString('en-US')} credits = $1 USD of gateway value.`;
}

function grossUsdForTargetNetUsd(
	subtotalUsd: number,
	fixedUsd = DEFAULT_PAYPAL_FEE_FIXED_USD,
	rate = DEFAULT_PAYPAL_FEE_RATE
): number {
	if (subtotalUsd <= 0) return 0;
	const gross = (subtotalUsd + fixedUsd) / (1 - rate);
	return Math.ceil(gross * 100) / 100;
}

function estimatedPaypalFeeUsd(
	grossUsd: number,
	fixedUsd = DEFAULT_PAYPAL_FEE_FIXED_USD,
	rate = DEFAULT_PAYPAL_FEE_RATE
): number {
	if (grossUsd <= 0) return 0;
	return Math.round((fixedUsd + rate * grossUsd) * 100) / 100;
}

/** Client-side checkout quote (mirrors server checkout-pricing defaults). */
export function computeTopUpCheckoutQuoteUi(credits: number): TopUpCheckoutQuoteUi | null {
	if (!Number.isInteger(credits) || credits < MIN_TOP_UP_CREDITS) return null;
	const baseUsd = credits / CREDITS_PER_USD;
	const markupUsd = baseUsd * PLATFORM_MARKUP_RATE;
	const platformSubtotalUsd = baseUsd + markupUsd;
	const grossUsd = grossUsdForTargetNetUsd(platformSubtotalUsd);
	const feeUsd = estimatedPaypalFeeUsd(grossUsd);
	return {
		credits,
		baseUsd,
		markupUsd,
		platformSubtotalUsd,
		estimatedPaypalFeeUsd: feeUsd,
		grossUsd
	};
}

/** Convert all-in stored total USD (gateway + markup) to a numeric credit amount. */
export function totalCostUsdToCredits(totalCostUsd: string): number {
	const parsed = Number(totalCostUsd);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return parsed * CREDITS_PER_USD;
}

/** User-facing Activity / totals label for a stored totalCostUsd string. */
export function formatActivityCredits(totalCostUsd: string): string {
	return formatCreditsAmount(totalCostUsdToCredits(totalCostUsd));
}

function formatCreditsAmount(credits: number): string {
	if (credits === 0) return '0';
	if (credits < 1) {
		const formatted = credits.toFixed(3).replace(/\.?0+$/, '');
		return formatted.length > 0 ? formatted : '0';
	}
	if (Number.isInteger(credits)) {
		return credits.toLocaleString('en-US');
	}
	return credits.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Sum multiple totalCostUsd strings and format as credits. */
export function formatActivityCreditsSum(totalCostUsdValues: string[]): string {
	let sum = 0;
	for (const v of totalCostUsdValues) {
		sum += totalCostUsdToCredits(v);
	}
	return formatCreditsAmount(sum);
}

/** Whole credits → USD amount for top-up / balance display. */
export function creditsToUsd(credits: number): number | null {
	if (!Number.isFinite(credits) || credits < 0) return null;
	return credits / CREDITS_PER_USD;
}

/** USD formatted for checkout and balance (e.g. `$10.00`). */
export function formatCreditsAsUsd(credits: number): string | null {
	const usd = creditsToUsd(credits);
	if (usd === null) return null;
	return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** Format a numeric USD amount for checkout lines. */
export function formatUsdAmount(usd: number): string {
	return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
