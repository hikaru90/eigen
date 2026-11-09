import { and, count, desc, eq, gt, inArray, isNotNull, min, notInArray, sql } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  nowCard,
  projectTaskSequence,
  temporalEvent,
  thought,
  thoughtEntity,
  type MemoryAuthor,
} from '$lib/server/db/schema'
import { snippetForOpenThread } from '$lib/server/memory/open-threads'
import { listProjectsForUser, type ProjectStalledReason } from '$lib/server/memory/project-list'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'

/**
 * Candidates for a Now deck (docs/planning/feature-mesh-now.md, NOW-4). Structural only:
 * open task/goal thoughts and active projects, minus anything hidden by an earlier answer.
 * Nothing here decides what a thing means or what matters; the deck writer judges.
 */

export const NOW_CANDIDATE_LIMIT = 150

export type NowThoughtCandidate = {
  thoughtId: string
  category: string
  snippet: string
  author: MemoryAuthor
  createdAt: string
  /** Project membership (the definition Threads and the digest use) and the rank in its sequence. */
  project: { id: string; label: string; rank: number | null } | null
  /** Earliest linked temporal event start. */
  eventAt: string | null
  /** This user's `not_now` answers for the thought. */
  skipCount: number
}

export type NowProjectCandidate = {
  entityId: string
  label: string
  deadline: string | null
  milestones: Array<{ label: string; targetDate: string | null; completedAt: string | null }>
  nextAction: string | null
  openTaskCount: number
  stalledReason: ProjectStalledReason | null
}

export type NowCandidates = {
  /** Oldest first. */
  thoughts: NowThoughtCandidate[]
  projects: NowProjectCandidate[]
  /** Open thoughts the cap left out (the oldest ones are dropped first, never silently). */
  candidatesOmitted: number
}

async function readSnippet(
  userId: string,
  row: { normalizedText: string | null; normalizedTextEncrypted: string | null },
): Promise<string> {
  const text = row.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: row.normalizedTextEncrypted,
      })
    : (row.normalizedText ?? '')
  return snippetForOpenThread(text)
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value

export async function loadNowCandidates(
  userId: string,
  now: Date = new Date(),
): Promise<NowCandidates> {
  const db = getDb()

  const hiddenRows = await db
    .select({ thoughtId: nowCard.targetThoughtId, projectEntityId: nowCard.targetProjectEntityId })
    .from(nowCard)
    .where(and(eq(nowCard.userId, userId), gt(nowCard.hiddenUntil, now)))
  const hiddenThoughtIds = hiddenRows.flatMap((r) => (r.thoughtId ? [r.thoughtId] : []))
  const hiddenProjectIds = new Set(hiddenRows.flatMap((r) => (r.projectEntityId ? [r.projectEntityId] : [])))

  // Newest NOW_CANDIDATE_LIMIT win; `total` is the uncapped count so the cut is reported.
  const [rows, projectItems] = await Promise.all([
    db
      .select({
        thoughtId: thought.id,
        category: thought.category,
        author: thought.author,
        createdAt: thought.createdAt,
        normalizedText: thought.normalizedText,
        normalizedTextEncrypted: thought.normalizedTextEncrypted,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(thought)
      .where(
        and(
          eq(thought.userId, userId),
          eq(thought.lifecycleStatus, 'open'),
          inArray(thought.category, ['task', 'goal']),
          ...(hiddenThoughtIds.length ? [notInArray(thought.id, hiddenThoughtIds)] : []),
        ),
      )
      .orderBy(desc(thought.createdAt))
      .limit(NOW_CANDIDATE_LIMIT),
    listProjectsForUser(userId, { authorScope: 'all' }),
  ])

  const projects: NowProjectCandidate[] = projectItems
    .filter((p) => p.status === 'active' && !hiddenProjectIds.has(p.entityId))
    .map((p) => ({
      entityId: p.entityId,
      label: p.label,
      deadline: p.targetDate,
      milestones: p.milestones.map((m) => ({
        label: m.label,
        targetDate: m.targetDate,
        completedAt: m.completedAt,
      })),
      nextAction: p.nextAction?.summary ?? null,
      openTaskCount: p.openTaskCount,
      stalledReason: p.stalled?.reason ?? null,
    }))

  if (rows.length === 0) return { thoughts: [], projects, candidatesOmitted: 0 }

  const ids = rows.map((r) => r.thoughtId)
  const [memberships, events, skips] = await Promise.all([
    db
      .select({
        thoughtId: thoughtEntity.thoughtId,
        projectEntityId: canonicalEntity.id,
        projectLabel: canonicalEntity.label,
        rank: projectTaskSequence.rank,
      })
      .from(thoughtEntity)
      .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
      .leftJoin(
        projectTaskSequence,
        and(
          eq(projectTaskSequence.thoughtId, thoughtEntity.thoughtId),
          eq(projectTaskSequence.projectEntityId, thoughtEntity.entityId),
        ),
      )
      .where(
        and(
          eq(thoughtEntity.userId, userId),
          inArray(thoughtEntity.thoughtId, ids),
          projectMembershipLinkCondition(),
          isNotNull(canonicalEntity.projectStatus),
        ),
      ),
    db
      .select({ thoughtId: temporalEvent.thoughtId, eventAt: min(temporalEvent.startAt) })
      .from(temporalEvent)
      .where(
        and(
          eq(temporalEvent.userId, userId),
          inArray(temporalEvent.thoughtId, ids),
          isNotNull(temporalEvent.startAt),
        ),
      )
      .groupBy(temporalEvent.thoughtId),
    db
      .select({ thoughtId: nowCard.targetThoughtId, skipCount: count() })
      .from(nowCard)
      .where(
        and(
          eq(nowCard.userId, userId),
          eq(nowCard.status, 'answered'),
          eq(nowCard.answer, 'not_now'),
          inArray(nowCard.targetThoughtId, ids),
        ),
      )
      .groupBy(nowCard.targetThoughtId),
  ])

  const projectByThought = new Map<string, NowThoughtCandidate['project']>()
  for (const m of memberships) {
    if (!projectByThought.has(m.thoughtId)) {
      projectByThought.set(m.thoughtId, { id: m.projectEntityId, label: m.projectLabel, rank: m.rank })
    }
  }
  const eventByThought = new Map(events.map((e) => [e.thoughtId, iso(e.eventAt)]))
  const skipsByThought = new Map(skips.map((s) => [s.thoughtId, s.skipCount]))

  const thoughts: NowThoughtCandidate[] = []
  for (const row of rows) {
    thoughts.push({
      thoughtId: row.thoughtId,
      category: row.category,
      snippet: await readSnippet(userId, row),
      author: row.author,
      createdAt: row.createdAt.toISOString(),
      project: projectByThought.get(row.thoughtId) ?? null,
      eventAt: eventByThought.get(row.thoughtId) ?? null,
      skipCount: skipsByThought.get(row.thoughtId) ?? 0,
    })
  }
  thoughts.reverse() // oldest first

  return {
    thoughts,
    projects,
    candidatesOmitted: Math.max(0, (rows[0]?.total ?? 0) - rows.length),
  }
}
