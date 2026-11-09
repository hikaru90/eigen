import { and, countDistinct, eq, gte, inArray, lt, or, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  dailyDigestProjectSnapshot,
  projectMilestone,
  temporalEvent,
  thought,
  thoughtEntity,
} from '$lib/server/db/schema'
import { resolveAuthorSqlCondition } from '$lib/server/memory/authorship'
import type {
  DailyDigestProject,
  DailyDigestProjectActivity,
  DailyDigestProjectChange,
  DailyDigestProjectChanges,
  DailyDigestSnippet,
  DailyDigestStalled,
} from '$lib/server/memory/daily-summary'
import { projectMembershipLinkCondition } from '$lib/server/memory/project-membership'

export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000
const MOST_ACTIVE_LIMIT = 3

export type ProjectMilestoneMovement = { label: string; kind: 'added' | 'changed' }

/** Per-project numbers for the 24 hours before the digest, keyed by project entity id. */
export type ProjectWindowActivity = {
  /** User-authored thoughts whose membership link to the project was created in the window. */
  newThoughts: Map<string, number>
  /** User-authored task thoughts on the project completed in the window. */
  tasksDone: Map<string, number>
  /** Open tasks on the project whose scheduled end/start is already past. */
  overdueTasks: Map<string, number>
  /** project_milestone rows created or updated in the window. */
  milestones: Map<string, ProjectMilestoneMovement[]>
}

function toCountMap(rows: { entityId: string; n: number }[]): Map<string, number> {
  return new Map(rows.map((row) => [row.entityId, Number(row.n)]))
}

export async function loadProjectWindowActivity(
  userId: string,
  now: Date,
): Promise<ProjectWindowActivity> {
  const since = new Date(now.getTime() - DIGEST_WINDOW_MS)
  const db = getDb()
  const userAuthor = resolveAuthorSqlCondition(
    { author: thought.author, authorKeyId: thought.authorKeyId, authorLabel: thought.authorLabel },
    { authorLayerKey: 'user' },
  )
  const authorFilter = userAuthor ? [userAuthor] : []

  const [linked, done, overdue, milestoneRows] = await Promise.all([
    db
      .select({ entityId: thoughtEntity.entityId, n: countDistinct(thought.id) })
      .from(thoughtEntity)
      .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
      .where(
        and(
          eq(thoughtEntity.userId, userId),
          projectMembershipLinkCondition(),
          gte(thoughtEntity.createdAt, since),
          inArray(thought.lifecycleStatus, ['open', 'completed']),
          ...authorFilter,
        ),
      )
      .groupBy(thoughtEntity.entityId),
    db
      .select({ entityId: thoughtEntity.entityId, n: countDistinct(thought.id) })
      .from(thoughtEntity)
      .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
      .where(
        and(
          eq(thoughtEntity.userId, userId),
          projectMembershipLinkCondition(),
          eq(thought.category, 'task'),
          eq(thought.lifecycleStatus, 'completed'),
          gte(thought.lifecycleCompletedAt, since),
          ...authorFilter,
        ),
      )
      .groupBy(thoughtEntity.entityId),
    db
      .select({ entityId: thoughtEntity.entityId, n: countDistinct(thought.id) })
      .from(temporalEvent)
      .innerJoin(thought, eq(temporalEvent.thoughtId, thought.id))
      .innerJoin(thoughtEntity, eq(thoughtEntity.thoughtId, thought.id))
      .where(
        and(
          eq(temporalEvent.userId, userId),
          projectMembershipLinkCondition(),
          eq(thought.category, 'task'),
          eq(thought.lifecycleStatus, 'open'),
          eq(temporalEvent.lifecycleStatus, 'open'),
          or(lt(temporalEvent.endAt, now), lt(temporalEvent.startAt, now)),
          ...authorFilter,
        ),
      )
      .groupBy(thoughtEntity.entityId),
    db
      .select({
        projectEntityId: projectMilestone.projectEntityId,
        label: projectMilestone.label,
        createdAt: projectMilestone.createdAt,
        updatedAt: projectMilestone.updatedAt,
      })
      .from(projectMilestone)
      .where(
        and(
          eq(projectMilestone.userId, userId),
          or(gte(projectMilestone.createdAt, since), gte(projectMilestone.updatedAt, since)),
        ),
      )
      .orderBy(projectMilestone.createdAt),
  ])

  const milestones = new Map<string, ProjectMilestoneMovement[]>()
  for (const row of milestoneRows) {
    const list = milestones.get(row.projectEntityId) ?? []
    list.push({ label: row.label, kind: row.createdAt >= since ? 'added' : 'changed' })
    milestones.set(row.projectEntityId, list)
  }
  return {
    newThoughts: toCountMap(linked),
    tasksDone: toCountMap(done),
    overdueTasks: toCountMap(overdue),
    milestones,
  }
}

/** Next action per project as recorded at the previous digest send (empty before the first). */
export async function loadProjectSnapshots(userId: string): Promise<Map<string, string | null>> {
  const rows = await getDb()
    .select({
      projectEntityId: dailyDigestProjectSnapshot.projectEntityId,
      nextActionSummary: dailyDigestProjectSnapshot.nextActionSummary,
    })
    .from(dailyDigestProjectSnapshot)
    .where(eq(dailyDigestProjectSnapshot.userId, userId))
  return new Map(rows.map((row) => [row.projectEntityId, row.nextActionSummary]))
}

/** Remember each active project's next action; called only after the digest went out. */
export async function recordDigestProjectSnapshots(
  userId: string,
  projects: DailyDigestProject[],
  now: Date,
): Promise<void> {
  if (projects.length === 0) return
  await getDb()
    .insert(dailyDigestProjectSnapshot)
    .values(
      projects.map((project) => ({
        userId,
        projectEntityId: project.entityId,
        nextActionSummary: project.nextAction,
        recordedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [dailyDigestProjectSnapshot.userId, dailyDigestProjectSnapshot.projectEntityId],
      set: {
        nextActionSummary: sql`excluded.next_action_summary`,
        recordedAt: sql`excluded.recorded_at`,
      },
    })
}

/** Pure assembly of the project sections from already-loaded data. */
export function computeProjectActivity(input: {
  projects: DailyDigestProject[]
  stalled: DailyDigestStalled[]
  unthreaded: { count: number; recent: DailyDigestSnippet[] }
  window: ProjectWindowActivity
  snapshot: Map<string, string | null>
}): DailyDigestProjectActivity {
  const { projects, window, snapshot } = input

  const mostActive = projects
    .map((project) => {
      const newThoughts = window.newThoughts.get(project.entityId) ?? 0
      const tasksDone = window.tasksDone.get(project.entityId) ?? 0
      return {
        entityId: project.entityId,
        label: project.label,
        newThoughts,
        tasksDone,
        score: newThoughts + tasksDone,
      }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MOST_ACTIVE_LIMIT)

  const changes: DailyDigestProjectChanges[] = []
  for (const project of projects) {
    const items: DailyDigestProjectChange[] = []
    const done = window.tasksDone.get(project.entityId) ?? 0
    if (done > 0) items.push({ kind: 'tasks_done', count: done })
    const linked = window.newThoughts.get(project.entityId) ?? 0
    if (linked > 0) items.push({ kind: 'thoughts_linked', count: linked })
    for (const movement of window.milestones.get(project.entityId) ?? []) {
      items.push({
        kind: movement.kind === 'added' ? 'milestone_added' : 'milestone_changed',
        label: movement.label,
      })
    }
    // no snapshot (first digest, or project new since) means nothing to compare against
    if (snapshot.has(project.entityId) && snapshot.get(project.entityId) !== project.nextAction) {
      items.push({
        kind: 'next_action_changed',
        from: snapshot.get(project.entityId) ?? null,
        to: project.nextAction,
      })
    }
    if (items.length > 0) changes.push({ entityId: project.entityId, label: project.label, items })
  }

  const stalledIds = new Set(input.stalled.map((row) => row.entityId))
  return {
    mostActive,
    changes,
    needCleanup: {
      stalled: input.stalled,
      noNextAction: projects
        .filter((project) => project.nextAction === null && !stalledIds.has(project.entityId))
        .map((project) => ({ entityId: project.entityId, label: project.label })),
      overdueTasks: projects.flatMap((project) => {
        const count = window.overdueTasks.get(project.entityId) ?? 0
        return count > 0 ? [{ entityId: project.entityId, label: project.label, count }] : []
      }),
      unthreaded: input.unthreaded,
    },
  }
}
