import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  projectMilestone,
  projectTaskSequence,
  thought,
  thoughtEntity,
  type MemoryAuthor,
  type ProjectSource,
  type ProjectStatus,
} from '$lib/server/db/schema'
import { auditGtdProjectProfiles } from '$lib/server/memory/judge-gtd-project'
import {
  countOpenTasksForProjectEntity,
  ensureProject,
  thoughtStatusFromMetadata,
} from '$lib/server/memory/project-eligibility'
import { upsertGraphHubEntity } from '$lib/server/memory/project-entity'
import type { ProjectMilestoneListItem } from '$lib/server/memory/project-timeline'
import { taskItemId } from '$lib/server/memory/temporal-event-list'

export type ProjectNextAction = {
  thoughtId: string
  summary: string
  itemId: string
}

export type ProjectTaskSequenceItem = {
  thoughtId: string
  summary: string
  itemId: string
  rank: number
}

export type ProjectListItem = {
  entityId: string
  label: string
  status: ProjectStatus
  source: ProjectSource
  nextAction: ProjectNextAction | null
  openTaskCount: number
  targetDate: string | null
  tasks: ProjectTaskSequenceItem[]
  milestones: ProjectMilestoneListItem[]
}

async function summarizeThought(userId: string, thoughtId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
    .limit(1)
  if (!row) return null

  const metadataJson = row.metadataEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'metadata',
        ciphertext: row.metadataEncrypted,
      })
    : JSON.stringify(row.metadata ?? {})
  const metadata = JSON.parse(metadataJson) as Record<string, unknown>
  if (thoughtStatusFromMetadata(metadata) === 'completed') return null

  const text = row.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: row.normalizedTextEncrypted,
      })
    : row.normalizedText
  const trimmed = text.trim()
  if (!trimmed) return null
  return trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed
}

async function loadTaskSequenceForProject(
  userId: string,
  projectEntityId: string,
): Promise<ProjectTaskSequenceItem[]> {
  const rows = await getDb()
    .select({
      thoughtId: projectTaskSequence.thoughtId,
      rank: projectTaskSequence.rank,
    })
    .from(projectTaskSequence)
    .where(
      and(
        eq(projectTaskSequence.userId, userId),
        eq(projectTaskSequence.projectEntityId, projectEntityId),
      ),
    )
    .orderBy(asc(projectTaskSequence.rank))

  const out: ProjectTaskSequenceItem[] = []
  for (const row of rows) {
    const summary = await summarizeThought(userId, row.thoughtId)
    if (!summary) continue
    out.push({
      thoughtId: row.thoughtId,
      summary,
      itemId: taskItemId(row.thoughtId),
      rank: row.rank,
    })
  }
  return out
}

async function loadMilestonesForProject(
  userId: string,
  projectEntityId: string,
): Promise<ProjectMilestoneListItem[]> {
  const rows = await getDb()
    .select({
      id: projectMilestone.id,
      label: projectMilestone.label,
      targetDate: projectMilestone.targetDate,
      rank: projectMilestone.rank,
      completedAt: projectMilestone.completedAt,
      linkedThoughtId: projectMilestone.linkedThoughtId,
    })
    .from(projectMilestone)
    .where(
      and(
        eq(projectMilestone.userId, userId),
        eq(projectMilestone.projectEntityId, projectEntityId),
      ),
    )
    .orderBy(asc(projectMilestone.rank), asc(projectMilestone.createdAt))

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    targetDate: row.targetDate ? row.targetDate.toISOString() : null,
    rank: row.rank,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    linkedThoughtId: row.linkedThoughtId,
  }))
}

function projectSortRank(item: ProjectListItem): number {
  if (item.status === 'active' && item.nextAction == null) return 0
  if (item.status === 'active') return 1
  if (item.status === 'someday') return 2
  return 3
}

export type ListProjectsOptions = {
  authorScope?: MemoryAuthor | 'all'
}

function isHumanOwnedProjectSource(source: ProjectSource): boolean {
  return source === 'manual' || source === 'grounding'
}

async function loadHumanLinkedProjectEntityIds(
  userId: string,
  projectEntityIds: string[],
): Promise<Set<string>> {
  if (projectEntityIds.length === 0) return new Set()

  const rows = await getDb()
    .selectDistinct({ entityId: thoughtEntity.entityId })
    .from(thoughtEntity)
    .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        inArray(thoughtEntity.entityId, projectEntityIds),
        eq(thought.author, 'user'),
      ),
    )

  return new Set(rows.map((row) => row.entityId))
}

export async function listProjectsForUser(
  userId: string,
  options?: ListProjectsOptions,
): Promise<ProjectListItem[]> {
  const authorScope = options?.authorScope ?? 'user'

  const projectRows = await getDb()
    .select({
      entityId: canonicalEntity.id,
      label: canonicalEntity.label,
      status: canonicalEntity.projectStatus,
      source: canonicalEntity.projectSource,
      nextActionThoughtId: canonicalEntity.nextActionThoughtId,
      targetDate: canonicalEntity.targetDate,
    })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        isNotNull(canonicalEntity.projectStatus),
        inArray(canonicalEntity.projectStatus, ['active', 'someday']),
      ),
    )

  const humanLinkedProjectIds =
    authorScope === 'user'
      ? await loadHumanLinkedProjectEntityIds(
          userId,
          projectRows.map((row) => row.entityId),
        )
      : null

  const visibleProjectRows =
    authorScope === 'all'
      ? projectRows
      : projectRows.filter((row) => {
          const source = (row.source ?? 'capture') as ProjectSource
          return isHumanOwnedProjectSource(source) || humanLinkedProjectIds!.has(row.entityId)
        })

  const items: ProjectListItem[] = []
  for (const row of visibleProjectRows) {
    const status = row.status as ProjectStatus
    const source = (row.source ?? 'capture') as ProjectSource
    let nextAction: ProjectNextAction | null = null
    if (row.nextActionThoughtId) {
      const summary = await summarizeThought(userId, row.nextActionThoughtId)
      if (summary) {
        nextAction = {
          thoughtId: row.nextActionThoughtId,
          summary,
          itemId: taskItemId(row.nextActionThoughtId),
        }
      }
    }
    const openTaskCount = await countOpenTasksForProjectEntity(userId, row.entityId)
    const tasks = await loadTaskSequenceForProject(userId, row.entityId)
    const milestones = await loadMilestonesForProject(userId, row.entityId)
    items.push({
      entityId: row.entityId,
      label: row.label,
      status,
      source,
      nextAction,
      openTaskCount,
      targetDate: row.targetDate ? row.targetDate.toISOString() : null,
      tasks,
      milestones,
    })
  }

  return items.sort((a, b) => {
    const rankDiff = projectSortRank(a) - projectSortRank(b)
    if (rankDiff !== 0) return rankDiff
    return a.label.localeCompare(b.label)
  })
}

/** Dismiss a project so it no longer appears in the active projects list.
 * Also removes the thought→entity links so thoughts are no longer tagged to the project.
 * The thoughts themselves are preserved. */
export async function dismissProject(userId: string, entityId: string): Promise<void> {
  // Remove all thought-entity links for this project so thoughts are untagged.
  await getDb()
    .delete(thoughtEntity)
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, entityId)))

  // Dismiss the project entity and clear nextActionThoughtId.
  await getDb()
    .update(canonicalEntity)
    .set({ projectStatus: 'dismissed', nextActionThoughtId: null, updatedAt: new Date() })
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, entityId)))
}

/** Create a new GTD project with manual source. */
export async function createProject(
  userId: string,
  label: string,
  options?: { status?: ProjectStatus },
): Promise<{ entityId: string; label: string; status: ProjectStatus; source: ProjectSource }> {
  const trimmedLabel = label.trim()
  if (!trimmedLabel) {
    throw new Error('Project label is required')
  }

  const status = options?.status ?? 'active'
  const source: ProjectSource = 'manual'

  // Create or update the graph entity
  const entityId = await upsertGraphHubEntity(userId, trimmedLabel, 'project')

  // Promote to GTD project
  await ensureProject(userId, entityId, status, source)

  return { entityId, label: trimmedLabel, status, source }
}

/** Update a project's label (name). */
export async function updateProjectLabel(
  userId: string,
  entityId: string,
  newLabel: string,
): Promise<{ entityId: string; label: string }> {
  const [updated] = await getDb()
    .update(canonicalEntity)
    .set({ label: newLabel, updatedAt: new Date() })
    .where(and(eq(canonicalEntity.id, entityId), eq(canonicalEntity.userId, userId)))
    .returning({ id: canonicalEntity.id, label: canonicalEntity.label })

  if (!updated) {
    throw new Error('Project not found or not owned by user')
  }

  return { entityId: updated.id, label: updated.label }
}

/** Update a project's status (active, someday, completed). */
export async function updateProjectStatus(
  userId: string,
  entityId: string,
  status: ProjectStatus,
): Promise<{ entityId: string; status: ProjectStatus }> {
  const [updated] = await getDb()
    .update(canonicalEntity)
    .set({ projectStatus: status, updatedAt: new Date() })
    .where(and(eq(canonicalEntity.id, entityId), eq(canonicalEntity.userId, userId)))
    .returning({ id: canonicalEntity.id, projectStatus: canonicalEntity.projectStatus })

  if (!updated) {
    throw new Error('Project not found or not owned by user')
  }

  return { entityId: updated.id, status: updated.projectStatus as ProjectStatus }
}

export {
  countLinkedThoughtsForProjectEntity,
  countOpenTasksForProjectEntity,
  ensureProject,
  ensureProjectProfile,
} from '$lib/server/memory/project-eligibility'

export type EligibleGtdProject = {
  entityId: string
  label: string
  status: ProjectStatus
  source: ProjectSource
  openTaskCount: number
}

/**
 * Shared assignment catalog for the assign dialog AND ingest LLM.
 * Includes active + someday; excludes completed / dismissed.
 */
export async function listEligibleProjectsForAssignment(
  userId: string,
): Promise<EligibleGtdProject[]> {
  const rows = await getDb()
    .select({
      entityId: canonicalEntity.id,
      label: canonicalEntity.label,
      status: canonicalEntity.projectStatus,
      source: canonicalEntity.projectSource,
    })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        isNotNull(canonicalEntity.projectStatus),
        inArray(canonicalEntity.projectStatus, ['active', 'someday']),
      ),
    )

  const out: EligibleGtdProject[] = []
  for (const row of rows) {
    const source = (row.source ?? 'capture') as ProjectSource
    const openTaskCount = await countOpenTasksForProjectEntity(userId, row.entityId)
    out.push({
      entityId: row.entityId,
      label: row.label,
      status: row.status as ProjectStatus,
      source,
      openTaskCount,
    })
  }
  return out
}

/** @deprecated Prefer listEligibleProjectsForAssignment — same catalog. */
export async function loadEligibleGtdProjects(userId: string): Promise<EligibleGtdProject[]> {
  return listEligibleProjectsForAssignment(userId)
}

/** @deprecated Use listEligibleProjectsForAssignment for assignment catalog. */
export async function loadGtdProjectOptionsFromProfiles(userId: string) {
  return listEligibleProjectsForAssignment(userId)
}

/**
 * Load catalog rows for specific project entity IDs (unified timeline join).
 * Returns only IDs that are still listed GTD projects (active/someday).
 */
export async function listProjectsByEntityIds(
  userId: string,
  entityIds: string[],
): Promise<ProjectListItem[]> {
  if (entityIds.length === 0) return []

  const projectRows = await getDb()
    .select({
      entityId: canonicalEntity.id,
      label: canonicalEntity.label,
      status: canonicalEntity.projectStatus,
      source: canonicalEntity.projectSource,
      nextActionThoughtId: canonicalEntity.nextActionThoughtId,
      targetDate: canonicalEntity.targetDate,
    })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        inArray(canonicalEntity.id, entityIds),
        isNotNull(canonicalEntity.projectStatus),
        inArray(canonicalEntity.projectStatus, ['active', 'someday']),
      ),
    )

  const items: ProjectListItem[] = []
  for (const row of projectRows) {
    const status = row.status as ProjectStatus
    const source = (row.source ?? 'capture') as ProjectSource
    let nextAction: ProjectNextAction | null = null
    if (row.nextActionThoughtId) {
      const summary = await summarizeThought(userId, row.nextActionThoughtId)
      if (summary) {
        nextAction = {
          thoughtId: row.nextActionThoughtId,
          summary,
          itemId: taskItemId(row.nextActionThoughtId),
        }
      }
    }
    const openTaskCount = await countOpenTasksForProjectEntity(userId, row.entityId)
    const tasks = await loadTaskSequenceForProject(userId, row.entityId)
    const milestones = await loadMilestonesForProject(userId, row.entityId)
    items.push({
      entityId: row.entityId,
      label: row.label,
      status,
      source,
      nextAction,
      openTaskCount,
      targetDate: row.targetDate ? row.targetDate.toISOString() : null,
      tasks,
      milestones,
    })
  }

  return items.sort((a, b) => {
    const rankDiff = projectSortRank(a) - projectSortRank(b)
    if (rankDiff !== 0) return rankDiff
    return a.label.localeCompare(b.label)
  })
}

export { auditGtdProjectProfiles }
