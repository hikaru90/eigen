import type { PageServerLoad } from './$types'
import type { ProjectStatus } from '$lib/server/db/schema'
import type { ProjectStalledReason } from '$lib/server/memory/project-list'
import { loadTimelinePageData } from '../../timeline/timeline-page-load'
import { groupItemsByThread, threadMeta, type ThreadMeta } from './thread-list'

/**
 * Threads — the projects the user follows (ei redesign, wave 3.2). The same
 * shared prefetch `/memory/projects` uses today (loadTimelinePageData →
 * loadUnifiedTimeline, src/lib/server/memory/timeline-unified.ts:45-72): its
 * `projects` are exactly the promoted GTD projects (project_status set,
 * project-list.ts:243-249 — never raw entity hubs), and its `items` are the
 * timeline rows the catalog already groups per project. This load only folds
 * them into the list's shape; nothing about the prefetch changes.
 */

export type ThreadListEntry = {
  entityId: string
  label: string
  status: ProjectStatus
  /** The next action's words (the user's) — the one line of "where it stands" we have. */
  nextActionSummary: string | null
  openTaskCount: number
  targetDate: string | null
  stalledReason: ProjectStalledReason | null
  thoughtCount: number
  lastAddedIso: string | null
}

export type ThreadsPageData = {
  preferredTimezone: string
  threads: ThreadListEntry[]
  loose: ThreadMeta
}

export const load: PageServerLoad = async (event) => {
  const data = await loadTimelinePageData(event)
  const { projects, items } = data.prefetchedTimeline
  const groups = groupItemsByThread(items)

  const threads: ThreadListEntry[] = projects.map((project) => {
    const meta = threadMeta(groups.byThread.get(project.entityId) ?? [])
    return {
      entityId: project.entityId,
      label: project.label,
      status: project.status,
      nextActionSummary: project.nextAction?.summary ?? null,
      openTaskCount: project.openTaskCount,
      targetDate: project.targetDate,
      stalledReason: project.stalled?.reason ?? null,
      thoughtCount: meta.thoughtCount,
      lastAddedIso: meta.lastAddedIso,
    }
  })

  return {
    user: data.user,
    preferredTimezone: data.preferredTimezone,
    threads,
    loose: threadMeta(groups.loose),
  } satisfies ThreadsPageData & { user: NonNullable<App.Locals['user']> }
}
