import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { and, eq } from 'drizzle-orm';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { authDb } from '$lib/server/db/auth-db';
import { user } from '$lib/server/db/auth.schema';
import { getDb } from '$lib/server/db';
import {
	userPreference,
	llmProviderConfig,
	llmActiveProvider,
	pushSubscription
} from '$lib/server/db/schema';

const LANGUAGE_OPTIONS = [
	{ value: 'en', label: 'English' },
	{ value: 'de', label: 'German' },
	{ value: 'fr', label: 'French' },
	{ value: 'es', label: 'Spanish' },
	{ value: 'it', label: 'Italian' },
	{ value: 'pt', label: 'Portuguese' },
	{ value: 'nl', label: 'Dutch' },
	{ value: 'pl', label: 'Polish' },
	{ value: 'tr', label: 'Turkish' },
	{ value: 'ru', label: 'Russian' },
	{ value: 'ja', label: 'Japanese' },
	{ value: 'ko', label: 'Korean' },
	{ value: 'zh', label: 'Chinese (Mandarin)' }
] as const;

const LANGUAGE_VALUES = new Set(LANGUAGE_OPTIONS.map((option) => option.value));

const QUALITY_OPTIONS = [
	{ value: 'low', label: 'Low', model: 'whisper-tiny', sizeMb: 64 },
	{ value: 'medium', label: 'Medium', model: 'whisper-base', sizeMb: 136 },
	{ value: 'high', label: 'High', model: 'whisper-small', sizeMb: 510 }
] as const;

const QUALITY_VALUES = new Set(QUALITY_OPTIONS.map((option) => option.value));

const normalizeLanguage = (value: string) => {
	const code = value.trim().toLowerCase();
	if (LANGUAGE_VALUES.has(code as (typeof LANGUAGE_OPTIONS)[number]['value'])) {
		return code as (typeof LANGUAGE_OPTIONS)[number]['value'];
	}
	return 'en';
};

const normalizeQuality = (value: string) => {
	const quality = value.trim().toLowerCase();
	if (QUALITY_VALUES.has(quality as (typeof QUALITY_OPTIONS)[number]['value'])) {
		return quality as (typeof QUALITY_OPTIONS)[number]['value'];
	}
	return 'low';
};

const getSafeErrorMessage = (error: unknown, fallback: string) => {
	if (error instanceof APIError) return error.message || fallback;
	if (error instanceof Error) return error.message || fallback;
	if (typeof error === 'object' && error !== null && 'message' in error) {
		const msg = (error as { message?: unknown }).message;
		if (typeof msg === 'string' && msg.trim().length > 0) return msg;
	}
	return fallback;
};

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}

	const [pref] = await getDb()
		.select({
			preferredLanguage: userPreference.preferredLanguage,
			preferredTranscriptionQuality: userPreference.preferredTranscriptionQuality
		})
		.from(userPreference)
		.where(eq(userPreference.userId, event.locals.user.id))
		.limit(1);

	// Load the active provider selection
	const [activeRow] = await getDb()
		.select({ provider: llmActiveProvider.provider })
		.from(llmActiveProvider)
		.where(eq(llmActiveProvider.userId, event.locals.user.id))
		.limit(1);

	const activeProvider = (activeRow?.provider ?? 'eurouter') as 'eurouter' | 'openrouter';

	// Load all saved provider configs so the UI can pre-fill each provider's form independently
	const providerRows = await getDb()
		.select()
		.from(llmProviderConfig)
		.where(eq(llmProviderConfig.userId, event.locals.user.id));

	const eurouterRow = providerRows.find((r) => r.provider === 'eurouter');
	const openrouterRow = providerRows.find((r) => r.provider === 'openrouter');

	const pushRows = await getDb()
		.select({ id: pushSubscription.id })
		.from(pushSubscription)
		.where(eq(pushSubscription.userId, event.locals.user.id));

	return {
		user: event.locals.user,
		preferredLanguage: pref?.preferredLanguage ?? 'en',
		preferredTranscriptionQuality: pref?.preferredTranscriptionQuality ?? 'low',
		languageOptions: LANGUAGE_OPTIONS,
		qualityOptions: QUALITY_OPTIONS,
		activeProvider,
		eurouter: {
			baseUrl: eurouterRow?.baseUrl ?? '',
			apiKey: eurouterRow?.apiKey ?? '',
			ruleChat: eurouterRow?.ruleChat ?? '',
			ruleEmbedding: eurouterRow?.ruleEmbedding ?? ''
		},
		openrouter: {
			baseUrl: openrouterRow?.baseUrl ?? '',
			apiKey: openrouterRow?.apiKey ?? '',
			modelChat: openrouterRow?.modelChat ?? '',
			modelEmbedding: openrouterRow?.modelEmbedding ?? ''
		},
		pushSubscriptionCount: pushRows.length
	};
};

export const actions: Actions = {
	updateLanguage: async (event) => {
		if (!event.locals.user) {
			return fail(401, { settingsMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const preferredLanguage = normalizeLanguage(formData.get('preferredLanguage')?.toString() ?? '');

		try {
			await getDb()
				.insert(userPreference)
				.values({ userId: event.locals.user.id, preferredLanguage })
				.onConflictDoUpdate({
					target: userPreference.userId,
					set: { preferredLanguage, updatedAt: new Date() }
				});
			return { settingsMessage: `Language preference updated to ${preferredLanguage}.` };
		} catch (error) {
			return fail(400, {
				settingsMessage: getSafeErrorMessage(error, 'Unable to save language preference.')
			});
		}
	},

	updateQuality: async (event) => {
		if (!event.locals.user) {
			return fail(401, { qualityMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const preferredTranscriptionQuality = normalizeQuality(
			formData.get('preferredTranscriptionQuality')?.toString() ?? ''
		);
		const qualityOption = QUALITY_OPTIONS.find(
			(option) => option.value === preferredTranscriptionQuality
		);

		try {
			await getDb()
				.insert(userPreference)
				.values({ userId: event.locals.user.id, preferredTranscriptionQuality })
				.onConflictDoUpdate({
					target: userPreference.userId,
					set: { preferredTranscriptionQuality, updatedAt: new Date() }
				});
			return {
				qualityMessage: `Speech recognition quality set to ${qualityOption?.label ?? 'Low'} (${qualityOption?.sizeMb ?? 64} MB).`
			};
		} catch (error) {
			return fail(400, {
				qualityMessage: getSafeErrorMessage(error, 'Unable to save quality preference.')
			});
		}
	},

	changeEmail: async (event) => {
		if (!event.locals.user) {
			return fail(401, { emailMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const newEmail = formData.get('newEmail')?.toString().trim().toLowerCase() ?? '';
		if (!newEmail) {
			return fail(400, { emailMessage: 'Please provide a valid email.' });
		}

		try {
			await auth.api.changeEmail({
				headers: event.request.headers,
				body: {
					newEmail
				}
			});
			return { emailMessage: 'Email change requested. Follow any verification email prompts.' };
		} catch (error) {
			return fail(400, { emailMessage: getSafeErrorMessage(error, 'Unable to change email.') });
		}
	},

	changePassword: async (event) => {
		if (!event.locals.user) {
			return fail(401, { passwordMessage: 'You must be signed in.' });
		}

		const formData = await event.request.formData();
		const currentPassword = formData.get('currentPassword')?.toString() ?? '';
		const newPassword = formData.get('newPassword')?.toString() ?? '';

		if (!currentPassword || !newPassword) {
			return fail(400, { passwordMessage: 'Please provide both current and new password.' });
		}
		if (newPassword.length < 8) {
			return fail(400, { passwordMessage: 'New password must be at least 8 characters.' });
		}

		try {
			await auth.api.changePassword({
				headers: event.request.headers,
				body: {
					currentPassword,
					newPassword,
					revokeOtherSessions: false
				}
			});
			return { passwordMessage: 'Password updated successfully.' };
		} catch (error) {
			return fail(400, {
				passwordMessage: getSafeErrorMessage(error, 'Unable to change password.')
			});
		}
	},

	resetOnboarding: async (event) => {
		if (!event.locals.user) {
			return fail(401, { onboardingMessage: 'You must be signed in.' });
		}

		try {
			await authDb
				.update(user)
				.set({ onboardingCompleted: false })
				.where(eq(user.id, event.locals.user.id));
		} catch (error) {
			return fail(400, {
				onboardingMessage: getSafeErrorMessage(error, 'Unable to reset onboarding.')
			});
		}

		throw redirect(303, '/capture');
	},

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
		const setActive = formData.get('setActive') === 'true';

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
			// Upsert this provider's credentials
			await db
				.insert(llmProviderConfig)
				.values({
					userId: event.locals.user.id,
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
			// Optionally mark this provider as active
			if (setActive) {
				await db
					.insert(llmActiveProvider)
					.values({ userId: event.locals.user.id, provider })
					.onConflictDoUpdate({
						target: llmActiveProvider.userId,
						set: { provider, updatedAt: new Date() }
					});
			}
			return { llmMessage: `${provider === 'eurouter' ? 'EUrouter' : 'OpenRouter'} configuration saved.` };
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
			await getDb()
				.insert(llmActiveProvider)
				.values({ userId: event.locals.user.id, provider })
				.onConflictDoUpdate({
					target: llmActiveProvider.userId,
					set: { provider, updatedAt: new Date() }
				});
			return { llmMessage: `Active provider set to ${provider === 'eurouter' ? 'EUrouter' : 'OpenRouter'}.` };
		} catch (error) {
			return fail(400, {
				llmMessage: getSafeErrorMessage(error, 'Unable to set active provider.')
			});
		}
	}
};
