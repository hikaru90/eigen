import type { PageServerLoad } from './$types'
import { getDb } from '$lib/server/db'
import { loadThoughtKindOptions } from '$lib/server/thought/kind-options'
import type { ThoughtKindOption } from '$lib/thought/kind-option'
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
  /** The type menu in an unfolded row. */
  kinds: ThoughtKindOption[]
}

export const load: PageServerLoad = async (event) => {
  const data = await loadTimelinePageData(event)
  const { loose } = groupItemsByThread(data.prefetchedTimeline.items)
  const kinds = await loadThoughtKindOptions(getDb(), data.user.id)
  return {
    user: data.user,
    preferredTimezone: data.preferredTimezone,
    kinds,
    thoughts: uniqueThoughts(loose).map(toThreadThought),
  } satisfies LooseEndsPageData & { user: NonNullable<App.Locals['user']> }
}
