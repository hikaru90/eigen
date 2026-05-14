import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authDb } from '$lib/server/db/auth-db';
import { user } from '$lib/server/db/auth.schema';
import { getDb } from '$lib/server/db';
import { userPreference, llmConfig } from '$lib/server/db/schema';
import { ensureUserOntologySeeded } from '$lib/server/ontology-db';
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

	const [llmRow] = await getDb()
		.select({ userId: llmConfig.userId })
		.from(llmConfig)
		.where(eq(llmConfig.userId, event.locals.user.id))
		.limit(1);

	return {
		user: event.locals.user,
		onboardingCompleted: authUser?.onboardingCompleted === true,
		llmConfigured: !!llmRow,
		preferredLanguage: pref?.preferredLanguage ?? 'en'
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
		const llmBaseUrl = formData.get('llmBaseUrl')?.toString().trim() ?? '';
		const llmApiKey = formData.get('llmApiKey')?.toString().trim() ?? '';
		const llmRuleChat = formData.get('llmRuleChat')?.toString().trim() || null;
		const llmRuleEmbedding = formData.get('llmRuleEmbedding')?.toString().trim() || null;

		if (!llmBaseUrl) {
			return fail(400, { llmMessage: 'Base URL is required.' });
		}
		if (!llmBaseUrl.startsWith('http://') && !llmBaseUrl.startsWith('https://')) {
			return fail(400, { llmMessage: 'Base URL must start with http:// or https://' });
		}
		if (!llmApiKey) {
			return fail(400, { llmMessage: 'API key is required.' });
		}

		await getDb()
			.insert(llmConfig)
			.values({
				userId: event.locals.user.id,
				llmBaseUrl: llmBaseUrl.replace(/\/$/, ''),
				llmApiKey,
				llmRuleChat,
				llmRuleEmbedding
			})
			.onConflictDoUpdate({
				target: llmConfig.userId,
				set: {
					llmBaseUrl: llmBaseUrl.replace(/\/$/, ''),
					llmApiKey,
					llmRuleChat,
					llmRuleEmbedding,
					updatedAt: new Date()
				}
			});

		return { llmConfigSaved: true as const };
	}
};
