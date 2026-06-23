import type { LayoutServerLoad } from './$types';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { userPreference } from '$lib/server/db/schema';
import { isUserAdmin } from '$lib/server/auth/user-role';
import { normalizeUiLocale } from '$lib/i18n/ui-locale';
import { cookieMaxAge, cookieName } from '$lib/paraglide/runtime';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	let preferredUiLocale: string | null = null;
	let preferredLanguage = 'en';
	let isAdmin = false;

	if (locals.user) {
		isAdmin = await isUserAdmin(locals.user.id);
		const [pref] = await getDb()
			.select({
				preferredUiLocale: userPreference.preferredUiLocale,
				preferredLanguage: userPreference.preferredLanguage
			})
			.from(userPreference)
			.where(eq(userPreference.userId, locals.user.id))
			.limit(1);

		preferredUiLocale = normalizeUiLocale(pref?.preferredUiLocale ?? 'en');
		preferredLanguage = pref?.preferredLanguage ?? 'en';
		const currentCookie = cookies.get(cookieName);
		if (currentCookie !== preferredUiLocale) {
			cookies.set(cookieName, preferredUiLocale, {
				path: '/',
				maxAge: cookieMaxAge,
				httpOnly: false,
				sameSite: 'lax'
			});
		}
	}

	return {
		user: locals.user ?? null,
		isAdmin,
		preferredUiLocale,
		preferredLanguage
	};
};
