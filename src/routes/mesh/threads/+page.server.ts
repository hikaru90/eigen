import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { loadThreadList, type ThreadList } from '$lib/server/mesh/thread-list'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

export type ThreadsPageData = ThreadList & { preferredTimezone: string }

/**
 * Threads seeds the default 'You' view; the page refetches /api/mesh/threads
 * when the header's data view is anything else (same contract as Yarn).
 */
export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login')
  const userId = event.locals.user.id
  event.depends('timeline:temporal-events', 'timeline:thoughts')

  const [preferredTimezone, list] = await Promise.all([
    getUserPreferredTimezone(userId),
    loadThreadList(userId, { author: 'user', authorLayerKey: null }),
  ])

  return {
    user: event.locals.user,
    preferredTimezone,
    ...list,
  } satisfies ThreadsPageData & { user: NonNullable<App.Locals['user']> }
}
