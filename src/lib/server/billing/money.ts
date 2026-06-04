import { priceCall } from '$lib/server/pricing';

/** One wallet cent ($0.01 USD) expressed in micro-USD (6 decimal places). */
export const MICRO_USD_PER_CENT = 10_000;

/** Convert a USD decimal string (6 dp) to integer cents, rounding to nearest cent. */
export function usdStringToCents(totalCostUsd: string): number {
	const parsed = Number(totalCostUsd);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('totalCostUsd must be a non-negative finite number');
	}
	return Math.round(parsed * 100);
}

/** Convert base USD (number) to billed cents including markup. */
export function baseUsdToBilledCents(baseCostUsd: number, markupRate?: number): number {
	const priced = priceCall(baseCostUsd, markupRate);
	return usdStringToCents(priced.totalCostUsd);
}

/** Total billed micro-USD (includes markup) from gateway base USD. */
export function baseUsdToTotalMicroUsd(baseCostUsd: number, markupRate?: number): number {
	if (baseCostUsd <= 0) return 0;
	const priced = priceCall(baseCostUsd, markupRate);
	return Math.round(Number(priced.totalCostUsd) * 1_000_000);
}

/** Whole wallet cents implied by an accumulated micro-USD balance. */
export function microUsdToWholeCents(microUsd: number): number {
	if (!Number.isInteger(microUsd) || microUsd < 0) {
		throw new Error('microUsd must be a non-negative integer');
	}
	return Math.floor(microUsd / MICRO_USD_PER_CENT);
}

export { microUsdToWholeCredits, usdToCredits, creditsToPayPalUsdAmount } from '$lib/server/billing/credits';

/** Format integer cents for display (e.g. 1050 -> "10.50"). */
export function formatCents(cents: number, currency: string): string {
	const major = (cents / 100).toFixed(2);
	return `${major} ${currency}`;
}

const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD']);

export function normalizeCurrencyCode(raw: string): string {
	const code = raw.trim().toUpperCase();
	if (!/^[A-Z]{3}$/.test(code)) {
		throw new Error('Currency must be a 3-letter ISO 4217 code');
	}
	if (!SUPPORTED_CURRENCIES.has(code)) {
		throw new Error(`Unsupported currency: ${code}`);
	}
	return code;
}

/** PayPal amount value from integer cents (two decimal places). */
export function centsToPayPalAmountValue(cents: number): string {
	if (!Number.isInteger(cents) || cents < 1) {
		throw new Error('Amount must be at least 1 cent');
	}
	return (cents / 100).toFixed(2);
}
