import type { PageServerLoad } from './$types'
import { loadTimelinePageData } from '../../../timeline/timeline-page-load'
import { groupItemsByThread, toThreadThought, uniqueThoughts, type ThreadThought } from '../thread-list'

/**
 * Loose ends — thoughts not on a thread (ei app.js:1066-1068, `openProjectId ===
 * 'loose'`). The same shared prefetch the list uses (loadTimelinePageData →
 * loadUnifiedTimeline); here only the items without a project link.
 */

export type LooseEndsPageData = {
  preferredTimezone: string
  thoughts: ThreadThought[]
}

export const load: PageServerLoad = async (event) => {
  const data = await loadTimelinePageData(event)
  const { loose } = groupItemsByThread(data.prefetchedTimeline.items)
  return {
    user: data.user,
    preferredTimezone: data.preferredTimezone,
    thoughts: uniqueThoughts(loose).map(toThreadThought),
  } satisfies LooseEndsPageData & { user: NonNullable<App.Locals['user']> }
}
