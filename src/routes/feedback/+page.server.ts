import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  // voice input on the composer transcribes in the user's language (same source as Capture)
  const [pref] = await getDb()
    .select({ preferredLanguage: userPreference.preferredLanguage })
    .from(userPreference)
    .where(eq(userPreference.userId, event.locals.user.id))
    .limit(1)

  return { user: event.locals.user, preferredLanguage: pref?.preferredLanguage ?? 'en' }
}
