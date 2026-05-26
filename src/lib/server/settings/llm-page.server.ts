import { fail, redirect } from '@sveltejs/kit';
import type { Actions, RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	userPreference,
	llmProviderConfig,
	llmActiveProvider,
	type BillingMode
} from '$lib/server/db/schema';
import {
	alignWalletCurrencyWithPreference,
	assertCanChangeWalletCurrency
} from '$lib/server/billing/wallet';
import { assertByokConfigured } from '$lib/server/billing/preferences';
import { normalizeCurrencyCode } from '$lib/server/billing/money';
import { getPayPalClientId, getPayPalWebSdkUrl, getPayPalClientSecret } from '$lib/server/billing/paypal';
import { env } from '$env/dynamic/private';

export type LlmProviderId = 'eurouter' | 'openrouter';

function getSafeErrorMessage(error: unknown, fallback: string) {
	if (error instanceof Error) return error.message || fallback;
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const msg = (error as { message?: unknown }).message;
		if (typeof msg === 'string' && msg.trim().length > 0) return msg;
	}
	return fallback;
}

export function isProviderConfigured(row: { baseUrl?: string | null; apiKey?: string | null } | undefined) {
	return Boolean(row?.baseUrl?.trim() && row?.apiKey?.trim());
}

export async function loadLlmSettingsPage(event: RequestEvent) {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const userId = event.locals.user.id;

	const [pref] = await getDb()
		.select({
			billingMode: userPreference.billingMode,
			defaultBillingCurrency: userPreference.defaultBillingCurrency
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId))
		.limit(1);

	const billingMode = (pref?.billingMode ?? 'platform_credits') as BillingMode;
	const defaultBillingCurrency = pref?.defaultBillingCurrency ?? 'USD';
	const wallet = await alignWalletCurrencyWithPreference(userId, defaultBillingCurrency);

	let paypalConfigured = false;
	let paypalClientId: string | null = null;
	let paypalSdkUrl: string | null = null;
	try {
		// Use the same resolution logic as the PayPal billing module,
		// so env naming aliases (PAYPAL_URL / PAYPAL_SECRET) work consistently.
		paypalClientId = getPayPalClientId();
		paypalSdkUrl = getPayPalWebSdkUrl();
		// Validate that capture credentials exist as well.
		// Validate capture credentials exist as well.
		// (getPayPalClientSecret + getPayPalApiBase will throw if missing)
		getPayPalClientSecret();
		paypalConfigured = true;
	} catch {
		paypalConfigured = false;
	}

	const [activeRow] = await getDb()
		.select({ provider: llmActiveProvider.provider })
		.from(llmActiveProvider)
		.where(eq(llmActiveProvider.userId, userId))
		.limit(1);

	const activeProvider = (activeRow?.provider ?? 'eurouter') as LlmProviderId;

	const providerRows = await getDb()
		.select()
		.from(llmProviderConfig)
		.where(eq(llmProviderConfig.userId, userId));

	const eurouterRow = providerRows.find((r) => r.provider === 'eurouter');
	const openrouterRow = providerRows.find((r) => r.provider === 'openrouter');
	const byokConfigured =
		isProviderConfigured(eurouterRow) || isProviderConfigured(openrouterRow);

	const tab = event.url.searchParams.get('tab');
	const initialTab = (
		tab === 'byok' || tab === 'credits' ? tab : billingMode === 'byok' ? 'byok' : 'credits'
	) as 'byok' | 'credits';

	return {
		billingMode,
		byokConfigured,
		defaultBillingCurrency,
		wallet,
		paypalConfigured,
		paypalClientId,
		paypalSdkUrl,
		activeProvider,
		initialTab,
		providers: {
			eurouter: {
				configured: isProviderConfigured(eurouterRow),
				baseUrl: eurouterRow?.baseUrl ?? '',
				apiKey: eurouterRow?.apiKey ?? '',
				ruleChat: eurouterRow?.ruleChat ?? '',
				ruleEmbedding: eurouterRow?.ruleEmbedding ?? ''
			},
			openrouter: {
				configured: isProviderConfigured(openrouterRow),
				baseUrl: openrouterRow?.baseUrl ?? '',
				apiKey: openrouterRow?.apiKey ?? '',
				modelChat: openrouterRow?.modelChat ?? '',
				modelEmbedding: openrouterRow?.modelEmbedding ?? ''
			}
		}
	};
}

export const llmSettingsActions: Actions = {
	saveLlmConfig: async (event) => {
		if (!event.locals.user) {
			return fail(401, { llmMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const provider = formData.get('provider')?.toString().trim() ?? '';
		const baseUrl = formData.get('baseUrl')?.toString().trim() ?? '';
		const apiKey = formData.get('apiKey')?.toString().trim() ?? '';
		const ruleChat = formData.get('ruleChat')?.toString().trim() || null;
		const ruleEmbedding = formData.get('ruleEmbedding')?.toString().trim() || null;
		const modelChat = formData.get('modelChat')?.toString().trim() || null;
		const modelEmbedding = formData.get('modelEmbedding')?.toString().trim() || null;
		const setActive = formData.get('setActive') !== 'false';

		if (provider !== 'eurouter' && provider !== 'openrouter') {
			return fail(400, { llmMessage: 'Invalid provider.' });
		}
		if (!baseUrl) {
			return fail(400, { llmMessage: 'Base URL is required.' });
		}
		if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
			return fail(400, { llmMessage: 'Base URL must start with http:// or https://' });
		}
		if (!apiKey) {
			return fail(400, { llmMessage: 'API key is required.' });
		}

		try {
			const db = getDb();
			const userId = event.locals.user.id;
			await db
				.insert(llmProviderConfig)
				.values({
					userId,
					provider,
					baseUrl: baseUrl.replace(/\/$/, ''),
					apiKey,
					ruleChat,
					ruleEmbedding,
					modelChat,
					modelEmbedding
				})
				.onConflictDoUpdate({
					target: [llmProviderConfig.userId, llmProviderConfig.provider],
					set: {
						baseUrl: baseUrl.replace(/\/$/, ''),
						apiKey,
						ruleChat,
						ruleEmbedding,
						modelChat,
						modelEmbedding,
						updatedAt: new Date()
					}
				});

			if (setActive) {
				await db
					.insert(llmActiveProvider)
					.values({ userId, provider })
					.onConflictDoUpdate({
						target: llmActiveProvider.userId,
						set: { provider, updatedAt: new Date() }
					});
			}

			await db
				.insert(userPreference)
				.values({ userId, billingMode: 'byok' })
				.onConflictDoUpdate({
					target: userPreference.userId,
					set: { billingMode: 'byok', updatedAt: new Date() }
				});

			const label = provider === 'eurouter' ? 'EUrouter' : 'OpenRouter';
			return { llmMessage: `${label} saved.`, billingMode: 'byok' as const };
		} catch (error) {
			return fail(400, {
				llmMessage: getSafeErrorMessage(error, 'Unable to save LLM configuration.')
			});
		}
	},

	setActiveProvider: async (event) => {
		if (!event.locals.user) {
			return fail(401, { llmMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const provider = formData.get('provider')?.toString().trim() ?? '';

		if (provider !== 'eurouter' && provider !== 'openrouter') {
			return fail(400, { llmMessage: 'Invalid provider.' });
		}

		try {
			const userId = event.locals.user.id;
			await assertByokConfigured(userId);
			const db = getDb();
			await db
				.insert(llmActiveProvider)
				.values({ userId, provider })
				.onConflictDoUpdate({
					target: llmActiveProvider.userId,
					set: { provider, updatedAt: new Date() }
				});
			await db
				.insert(userPreference)
				.values({ userId, billingMode: 'byok' })
				.onConflictDoUpdate({
					target: userPreference.userId,
					set: { billingMode: 'byok', updatedAt: new Date() }
				});
			return { llmMessage: `Active provider set to ${provider === 'eurouter' ? 'EUrouter' : 'OpenRouter'}.` };
		} catch (error) {
			return fail(400, {
				llmMessage: getSafeErrorMessage(error, 'Unable to set active provider.')
			});
		}
	},

	setBillingMode: async (event) => {
		if (!event.locals.user) {
			return fail(401, { billingMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const raw = formData.get('billingMode')?.toString().trim() ?? '';
		if (raw !== 'platform_credits' && raw !== 'byok') {
			return fail(400, { billingMessage: 'Invalid billing method.' });
		}

		const billingMode = raw as BillingMode;
		const userId = event.locals.user.id;

		try {
			if (billingMode === 'byok') {
				await assertByokConfigured(userId);
			}

			await getDb()
				.insert(userPreference)
				.values({ userId, billingMode })
				.onConflictDoUpdate({
					target: userPreference.userId,
					set: { billingMode, updatedAt: new Date() }
				});

			const billingMessage =
				billingMode === 'byok'
					? 'LLM calls will use your OpenRouter / EUrouter keys.'
					: 'LLM calls will use Eigen platform credits.';
			return { billingMessage, billingMode };
		} catch (error) {
			return fail(400, {
				billingMessage: getSafeErrorMessage(error, 'Unable to update billing method.')
			});
		}
	},

	updateBillingCurrency: async (event) => {
		if (!event.locals.user) {
			return fail(401, { billingMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const raw = formData.get('defaultBillingCurrency')?.toString() ?? '';
		try {
			const defaultBillingCurrency = normalizeCurrencyCode(raw);
			const userId = event.locals.user.id;
			const changeCheck = await assertCanChangeWalletCurrency(userId, defaultBillingCurrency);
			if (!changeCheck.ok) {
				return fail(400, { billingMessage: changeCheck.message });
			}
			await getDb()
				.insert(userPreference)
				.values({
					userId,
					defaultBillingCurrency
				})
				.onConflictDoUpdate({
					target: userPreference.userId,
					set: { defaultBillingCurrency, updatedAt: new Date() }
				});
			await alignWalletCurrencyWithPreference(userId, defaultBillingCurrency);
			return { billingMessage: `Default billing currency set to ${defaultBillingCurrency}.` };
		} catch (error) {
			return fail(400, {
				billingMessage: getSafeErrorMessage(error, 'Unable to save billing currency.')
			});
		}
	}
};
