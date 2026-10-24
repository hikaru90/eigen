import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { loadDailyDigest } from '$lib/server/memory/daily-digest'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

/** The daily summary in full — the push and email headline open this page. */
export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/login')
  const timeZone = await getUserPreferredTimezone(locals.user.id)
  return { digest: await loadDailyDigest(locals.user.id, timeZone) }
}
