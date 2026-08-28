import { redirect } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { userPreference } from '$lib/server/db/schema'
import { loadUnifiedTimeline } from '$lib/server/memory/timeline-unified'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

type TimelinePageLoadEvent = {
  locals: App.Locals
  depends: (...deps: string[]) => void
}

/** Shared SSR prefetch for Tasks and Projects Memory hub pages. */
export async function loadTimelinePageData(event: TimelinePageLoadEvent) {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  const userId = event.locals.user.id

  event.depends('timeline:temporal-events', 'timeline:thoughts')

  const [preferredTimezoneResult, prefResult, timelineResult] = await Promise.all([
    getUserPreferredTimezone(userId),
    getDb()
      .select({
        eventNotificationsEnabled: userPreference.eventNotificationsEnabled,
        eventReminderLeadMinutes: userPreference.eventReminderLeadMinutes,
      })
      .from(userPreference)
      .where(eq(userPreference.userId, userId))
      .limit(1),
    loadUnifiedTimeline({
      userId,
      orderBy: 'ingest',
      sortDirection: 'desc',
      author: 'user',
      from: null,
      to: null,
      includeUndated: true,
    }),
  ])

  const pref = prefResult[0]

  return {
    user: event.locals.user,
    preferredTimezone: preferredTimezoneResult,
    eventNotificationsEnabled: pref?.eventNotificationsEnabled ?? false,
    eventReminderLeadMinutes: pref?.eventReminderLeadMinutes ?? 10,
    prefetchedTimeline: timelineResult,
    /**
     * Author scope the prefetch used (the global view lives in client
     * localStorage, so SSR always fetches 'user'). The shell compares this
     * to the client's current view and refetches on mismatch.
     */
    prefetchedAuthorScope: 'user' as const,
  }
}
