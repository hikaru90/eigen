import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authDb } from '$lib/server/db/auth-db';
import { user } from '$lib/server/db/auth.schema';
import { getDb } from '$lib/server/db';
import { userPreference, llmProviderConfig, llmActiveProvider } from '$lib/server/db/schema';
import { ensureUserOntologySeeded } from '$lib/server/ontology-db';
import { loadRecentCaptureThoughts } from '$lib/server/capture/load-recent-capture-thoughts';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/login');
	}
	await ensureUserOntologySeeded(getDb(), event.locals.user.id);
	const [pref] = await getDb()
		.select({
			preferredLanguage: userPreference.preferredLanguage
		})
		.from(userPreference)
		.where(eq(userPreference.userId, event.locals.user.id))
		.limit(1);

	const [authUser] = await authDb
		.select({ onboardingCompleted: user.onboardingCompleted })
		.from(user)
		.where(eq(user.id, event.locals.user.id))
		.limit(1);

	// llmConfigured: at least one provider row exists with credentials
	const [anyProvider] = await getDb()
		.select({ userId: llmProviderConfig.userId })
		.from(llmProviderConfig)
		.where(eq(llmProviderConfig.userId, event.locals.user.id))
		.limit(1);

	const { recentThoughts, recentThoughtDetails } = await loadRecentCaptureThoughts(
		event.locals.user.id
	);

	return {
		user: event.locals.user,
		onboardingCompleted: authUser?.onboardingCompleted === true,
		llmConfigured: !!anyProvider,
		preferredLanguage: pref?.preferredLanguage ?? 'en',
		recentThoughts,
		recentThoughtDetails
	};
};

export const actions: Actions = {
	completeOnboarding: async (event) => {
		if (!event.locals.user) {
			return fail(401, { message: 'Unauthorized' });
		}

		await authDb
			.update(user)
			.set({ onboardingCompleted: true })
			.where(eq(user.id, event.locals.user.id));

		return { ok: true as const };
	},

	saveLlmConfig: async (event) => {
		if (!event.locals.user) {
			return fail(401, { llmMessage: 'Unauthorized' });
		}

		const formData = await event.request.formData();
		const provider = formData.get('provider')?.toString().trim() ?? 'eurouter';
		const baseUrl = formData.get('baseUrl')?.toString().trim() ?? '';
		const apiKey = formData.get('apiKey')?.toString().trim() ?? '';
		const ruleChat = formData.get('ruleChat')?.toString().trim() || null;
		const ruleEmbedding = formData.get('ruleEmbedding')?.toString().trim() || null;
		const modelChat = formData.get('modelChat')?.toString().trim() || null;
		const modelEmbedding = formData.get('modelEmbedding')?.toString().trim() || null;

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

		const db = getDb();
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

		// Also set this as the active provider
		await db
			.insert(llmActiveProvider)
			.values({ userId: event.locals.user.id, provider })
			.onConflictDoUpdate({
				target: llmActiveProvider.userId,
				set: { provider, updatedAt: new Date() }
			});

		return { llmConfigSaved: true as const };
	}
};
