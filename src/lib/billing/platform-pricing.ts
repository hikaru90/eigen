/** Eigen platform credits per one US dollar (matches server CREDITS_PER_USD). */
export const CREDITS_PER_USD = 1000;

/** Minimum PayPal top-up (matches server MIN_TOP_UP_CREDITS). */
export const MIN_TOP_UP_CREDITS = 1000;

/** Default platform markup on gateway usage (matches server DEFAULT_MARKUP_RATE). */
export const PLATFORM_MARKUP_RATE = 0.2;

export function platformMarkupPercentLabel(): string {
	return `${Math.round(PLATFORM_MARKUP_RATE * 100)}%`;
}

/** Shown at credit purchase only — not in Activity. */
export function purchaseMarkupDisclosureText(): string {
	return `Usage debits your wallet in Eigen credits at gateway rates plus a ${platformMarkupPercentLabel()} platform fee. Top-ups are ${CREDITS_PER_USD.toLocaleString('en-US')} credits per $1 USD.`;
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
