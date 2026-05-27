import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { llmProviderConfig, userPreference, type BillingMode } from '$lib/server/db/schema';
import { normalizeCurrencyCode } from '$lib/server/billing/money';

export type BillingPreferences = {
	billingMode: BillingMode;
	defaultBillingCurrency: string;
};

export async function getBillingPreferences(userId: string): Promise<BillingPreferences> {
	const [row] = await getDb()
		.select({
			billingMode: userPreference.billingMode,
			defaultBillingCurrency: userPreference.defaultBillingCurrency
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId))
		.limit(1);

	return {
		billingMode: (row?.billingMode ?? 'platform_credits') as BillingMode,
		defaultBillingCurrency: row?.defaultBillingCurrency ?? 'USD'
	};
}

export async function isByokBilling(userId: string): Promise<boolean> {
	const prefs = await getBillingPreferences(userId);
	return prefs.billingMode === 'byok';
}

/** True when the user has at least one stored OpenRouter or EUrouter credential row. */
export async function hasSavedByokLlmCredentials(userId: string): Promise<boolean> {
	const rows = await getDb()
		.select({
			baseUrl: llmProviderConfig.baseUrl,
			apiKey: llmProviderConfig.apiKey
		})
		.from(llmProviderConfig)
		.where(eq(llmProviderConfig.userId, userId));

	return rows.some((r) => Boolean(r.baseUrl?.trim() && r.apiKey?.trim()));
}

/** PayPal-inferred currency first, then user setting. */
export function resolveCheckoutCurrency(
	prefs: BillingPreferences,
	paypalCurrency?: string | null
): string {
	if (paypalCurrency?.trim()) {
		return normalizeCurrencyCode(paypalCurrency);
	}
	return normalizeCurrencyCode(prefs.defaultBillingCurrency);
}

export async function assertByokConfigured(userId: string): Promise<void> {
	const ok = await hasSavedByokLlmCredentials(userId);
	if (!ok) {
		throw new Error(
			'BYOK requires saved OpenRouter or EUrouter credentials under Settings → LLM → BYOK.'
		);
	}
}
