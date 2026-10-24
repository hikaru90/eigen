import type { LayoutServerLoad } from './$types'
import { eq } from 'drizzle-orm'
import { normalizeUiLocale } from '$lib/i18n/ui-locale'
import { cookieMaxAge, cookieName } from '$lib/paraglide/runtime'
import { isUserAdmin } from '$lib/server/auth/user-role'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'
import { listAuthorLayersForUser } from '$lib/server/memory/authorship'
import { loadYouCounts, type YouCounts } from '$lib/server/memory/you-counts'
import { warmPatternsForUser } from '$lib/server/patterns/patterns-service'

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
  let preferredUiLocale: string | null = null
  let preferredLanguage = 'en'
  let isAdmin = false
  let betaAgreementAccepted = true
  let authorLayers: Awaited<ReturnType<typeof listAuthorLayersForUser>> = []
  let youCounts: YouCounts | null = null

  if (locals.user) {
    // today's patterns start computing now, so the Patterns tab opens on a ready result
    warmPatternsForUser(locals.user.id)
    isAdmin = await isUserAdmin(locals.user.id)
    authorLayers = await listAuthorLayersForUser(locals.user.id)
    youCounts = await loadYouCounts(locals.user.id)
    const [pref] = await getDb()
      .select({
        preferredUiLocale: userPreference.preferredUiLocale,
        preferredLanguage: userPreference.preferredLanguage,
        betaAgreementAcceptedAt: userPreference.betaAgreementAcceptedAt,
      })
      .from(userPreference)
      .where(eq(userPreference.userId, locals.user.id))
      .limit(1)

    preferredUiLocale = normalizeUiLocale(pref?.preferredUiLocale ?? 'en')
    preferredLanguage = pref?.preferredLanguage ?? 'en'
    betaAgreementAccepted = pref?.betaAgreementAcceptedAt != null
    const currentCookie = cookies.get(cookieName)
    if (currentCookie !== preferredUiLocale) {
      cookies.set(cookieName, preferredUiLocale, {
        path: '/',
        maxAge: cookieMaxAge,
        httpOnly: false,
        sameSite: 'lax',
      })
    }
  }

  return {
    user: locals.user ?? null,
    isAdmin,
    betaAgreementAccepted,
    preferredUiLocale,
    preferredLanguage,
    authorLayers,
    youCounts,
  }
}
