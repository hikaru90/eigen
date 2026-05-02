import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) {
		throw redirect(302, '/demo/better-auth/login');
	}
	const [pref] = await db
		.select({
			preferredLanguage: userPreference.preferredLanguage,
			preferredTranscriptionQuality: userPreference.preferredTranscriptionQuality
		})
		.from(userPreference)
		.where(eq(userPreference.userId, event.locals.user.id))
		.limit(1);

	return {
		user: event.locals.user,
		preferredLanguage: pref?.preferredLanguage ?? 'en',
		preferredTranscriptionQuality: pref?.preferredTranscriptionQuality ?? 'low'
	};
};
