import type { MemoryAuthor, ProjectStatus } from '$lib/server/db/schema'
import type { ProjectStalledReason } from '$lib/server/memory/project-list'
import { loadUnifiedTimeline } from '$lib/server/memory/timeline-unified'
import {
  groupItemsByThread,
  threadMeta,
  type ThreadMeta,
} from '../../../routes/mesh/threads/thread-list'

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

export type ThreadList = {
  threads: ThreadListEntry[]
  loose: ThreadMeta
}

export type ThreadListScope = {
  author: MemoryAuthor | 'all' | undefined
  authorLayerKey: string | null
}

/**
 * Threads — the projects the user follows, in one data view (the header
 * dropdown). Built on loadUnifiedTimeline (timeline-unified.ts), whose
 * `projects` are exactly the promoted GTD projects for the same author scope
 * as its `items`; this only folds them into the list's shape. The page server
 * seeds the 'You' scope; GET /api/mesh/threads serves every other view.
 */
export async function loadThreadList(userId: string, scope: ThreadListScope): Promise<ThreadList> {
  const { projects, items } = await loadUnifiedTimeline({
    userId,
    orderBy: 'ingest',
    sortDirection: 'desc',
    author: scope.author,
    authorLayerKey: scope.authorLayerKey,
    from: null,
    to: null,
    includeUndated: true,
  })
  const groups = groupItemsByThread(items)

  const threads = projects.map((project): ThreadListEntry => {
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

  return { threads, loose: threadMeta(groups.loose) }
}
