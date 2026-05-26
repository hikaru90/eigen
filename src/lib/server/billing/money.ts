import { priceCall } from '$lib/server/pricing';

/** Convert a USD decimal string (6 dp) to integer cents, rounding up. */
export function usdStringToCents(totalCostUsd: string): number {
	const parsed = Number(totalCostUsd);
	if (!Number.isFinite(parsed) || parsed < 0) {
		throw new Error('totalCostUsd must be a non-negative finite number');
	}
	return Math.ceil(parsed * 100);
}

/** Convert base USD (number) to billed cents including markup. */
export function baseUsdToBilledCents(baseCostUsd: number, markupRate?: number): number {
	const priced = priceCall(baseCostUsd, markupRate);
	return usdStringToCents(priced.totalCostUsd);
}

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
