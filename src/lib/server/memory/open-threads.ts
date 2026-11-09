import { and, asc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { canonicalEntity, projectTaskSequence, thought, thoughtEntity } from '$lib/server/db/schema'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'
import { listProjectsForUser, type ProjectNextAction, type ProjectStalledSignal } from '$lib/server/memory/project-list'

/**
 * One reliability sweep for agents (daily digests, weekly reviews): the
 * active projects whose deterministic stalled signal fired, plus orphan
 * open task/goal thoughts that belong to NO project. Listing orphans
 * is a read-model query over stored LLM categories — no classification
 * happens here (LLM-as-judge policy untouched).
 */

export type StalledProjectView = {
  entityId: string
  label: string
  stalled: ProjectStalledSignal
  openTaskCount: number
  targetDate: string | null
  nextAction: ProjectNextAction | null
}

export type OrphanThreadView = {
  thoughtId: string
  category: string
  createdAt: string
  snippet: string
}

export type OpenThreadsView = {
  stalledProjects: StalledProjectView[]
  orphanThreads: OrphanThreadView[]
}

const SNIPPET_MAX_CHARS = 160
const ORPHAN_LIMIT = 50

/** First line, hard-truncated — deterministic, no model call. */
export function snippetForOpenThread(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? ''
  return firstLine.length > SNIPPET_MAX_CHARS
    ? `${firstLine.slice(0, SNIPPET_MAX_CHARS - 1)}…`
    : firstLine
}

export async function loadOpenThreads(
  userId: string,
  options?: { authorScope?: 'user' | 'all' },
): Promise<OpenThreadsView> {
  const projects = await listProjectsForUser(userId, {
    authorScope: options?.authorScope ?? 'all',
  })
  const stalledProjects: StalledProjectView[] = projects
    .filter((p) => p.status === 'active' && p.stalled)
    .map((p) => ({
      entityId: p.entityId,
      label: p.label,
      stalled: p.stalled,
      openTaskCount: p.openTaskCount,
      targetDate: p.targetDate,
      nextAction: p.nextAction,
    }))

  // Open task/goal thoughts that are in no project: no sequence row AND no
  // project membership (the membership definition shared with Yarn, Threads and
  // the digest: manual/project link to an entity with a project_status; a plain
  // mention is not membership). notInArray over the sub-selects keeps this one
  // round-trip and RLS-scoped by user_id.
  const sequencedIds = getDb()
    .select({ thoughtId: projectTaskSequence.thoughtId })
    .from(projectTaskSequence)
    .where(eq(projectTaskSequence.userId, userId))
  const memberIds = getDb()
    .select({ thoughtId: thoughtEntity.thoughtId })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        projectMembershipLinkCondition(),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )

  const rows = await getDb()
    .select({
      thoughtId: thought.id,
      category: thought.category,
      createdAt: thought.createdAt,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        eq(thought.lifecycleStatus, 'open'),
        inArray(thought.category, ['task', 'goal']),
        notInArray(thought.id, sequencedIds),
        notInArray(thought.id, memberIds),
      ),
    )
    .orderBy(asc(thought.createdAt))
    .limit(ORPHAN_LIMIT)

  const orphanThreads: OrphanThreadView[] = []
  for (const row of rows) {
    const text = row.normalizedTextEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : (row.normalizedText ?? '')
    orphanThreads.push({
      thoughtId: row.thoughtId,
      category: row.category,
      createdAt: row.createdAt.toISOString(),
      snippet: snippetForOpenThread(text),
    })
  }

  return { stalledProjects, orphanThreads }
}
