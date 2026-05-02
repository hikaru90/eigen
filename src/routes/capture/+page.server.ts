import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authDb } from '$lib/server/db/auth-db';
import { user } from '$lib/server/db/auth.schema';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

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

	const [authUser] = await authDb
		.select({ onboardingCompleted: user.onboardingCompleted })
		.from(user)
		.where(eq(user.id, event.locals.user.id))
		.limit(1);

	return {
		user: event.locals.user,
		onboardingCompleted: authUser?.onboardingCompleted === true,
		preferredLanguage: pref?.preferredLanguage ?? 'en',
		preferredTranscriptionQuality: pref?.preferredTranscriptionQuality ?? 'low'
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
	}
};
