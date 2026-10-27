import { and, count, eq, inArray, max } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought, thoughtEntity, type MemoryAuthor, type ProjectStatus } from '$lib/server/db/schema'
import { resolveAuthorSqlCondition } from '$lib/server/memory/authorship'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'
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
 * How many thoughts sit on each thread, and when the last one was added — from thread
 * membership, the rule the thread page lists by (a decision or a question counts, not
 * only the tasks the timeline carries).
 */
async function loadThreadMembershipMeta(
  userId: string,
  entityIds: string[],
  scope: ThreadListScope,
): Promise<Map<string, { thoughtCount: number; lastAddedIso: string | null }>> {
  const out = new Map<string, { thoughtCount: number; lastAddedIso: string | null }>()
  if (entityIds.length === 0) return out
  const authorCondition = resolveAuthorSqlCondition(
    { author: thought.author, authorKeyId: thought.authorKeyId, authorLabel: thought.authorLabel },
    { author: scope.author === 'all' ? undefined : scope.author, authorLayerKey: scope.authorLayerKey },
  )
  const rows = await getDb()
    .select({
      entityId: thoughtEntity.entityId,
      thoughtCount: count(thought.id),
      lastAdded: max(thought.createdAt),
    })
    .from(thoughtEntity)
    .innerJoin(thought, and(eq(thought.id, thoughtEntity.thoughtId), eq(thought.userId, userId)))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        inArray(thoughtEntity.entityId, entityIds),
        projectMembershipLinkCondition(),
        inArray(thought.lifecycleStatus, ['open', 'completed']),
        ...(authorCondition ? [authorCondition] : []),
      ),
    )
    .groupBy(thoughtEntity.entityId)
  for (const row of rows) {
    out.set(row.entityId, {
      thoughtCount: Number(row.thoughtCount),
      lastAddedIso: row.lastAdded ? new Date(row.lastAdded).toISOString() : null,
    })
  }
  return out
}

/**
 * Newest first by the thread's last added thought; a thread with no thoughts goes last.
 * Array.sort is stable, so equal times (and the empty threads) keep the incoming order.
 */
function byLastAddedDesc(a: ThreadListEntry, b: ThreadListEntry): number {
  if (a.lastAddedIso === b.lastAddedIso) return 0
  if (a.lastAddedIso === null) return 1
  if (b.lastAddedIso === null) return -1
  return Date.parse(b.lastAddedIso) - Date.parse(a.lastAddedIso)
}

/**
 * Threads — the projects the user follows, in one data view (the header
 * dropdown). Built on loadUnifiedTimeline (timeline-unified.ts), whose
 * `projects` are exactly the promoted GTD projects for the same author scope
 * as its `items`; this only folds them into the list's shape, newest first by
 * the last thought added to each thread. The page server seeds the 'You'
 * scope; GET /api/mesh/threads serves every other view.
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
  const membership = await loadThreadMembershipMeta(
    userId,
    projects.map((project) => project.entityId),
    scope,
  )

  const threads = projects.map((project): ThreadListEntry => {
    const meta = membership.get(project.entityId) ?? { thoughtCount: 0, lastAddedIso: null }
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
  threads.sort(byLastAddedDesc)

  return { threads, loose: threadMeta(groups.loose) }
}
