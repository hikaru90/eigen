import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm'
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
import {
  resolveAuthorSqlCondition,
  type AuthorLayerSqlColumns,
} from '$lib/server/memory/authorship'
import type { SQL } from 'drizzle-orm'
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

export type ProjectCatalogScope =
  | { kind: 'user' }
  | { kind: 'all' }
  | { kind: 'authorLayer'; author: MemoryAuthor; authorLayerKey?: string | null }

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

const CANONICAL_ENTITY_AUTHOR_COLUMNS: AuthorLayerSqlColumns = {
  author: canonicalEntity.author,
  authorKeyId: canonicalEntity.authorKeyId,
  authorLabel: canonicalEntity.authorLabel,
}

const PROJECT_ROW_COLUMNS = {
  entityId: canonicalEntity.id,
  label: canonicalEntity.label,
  status: canonicalEntity.projectStatus,
  source: canonicalEntity.projectSource,
  nextActionThoughtId: canonicalEntity.nextActionThoughtId,
  targetDate: canonicalEntity.targetDate,
}

function baseProjectConditions(userId: string) {
  return [
    eq(canonicalEntity.userId, userId),
    isNotNull(canonicalEntity.projectStatus),
    inArray(canonicalEntity.projectStatus, ['active', 'someday']),
  ]
}

async function loadProjectRows(
  userId: string,
  extraCondition: SQL | undefined,
  entityIds?: string[],
) {
  return getDb()
    .select(PROJECT_ROW_COLUMNS)
    .from(canonicalEntity)
    .where(
      and(
        ...baseProjectConditions(userId),
        ...(entityIds ? [inArray(canonicalEntity.id, entityIds)] : []),
        ...(extraCondition ? [extraCondition] : []),
      ),
    )
}

/**
 * Single project-catalog loader. `scope` picks the visible set:
 * - 'user'  → human-owned (manual/grounding) OR linked to ≥1 human thought
 * - 'all'   → every listed GTD project
 * - 'authorLayer' → authored by that author layer, OR linked to ≥1 thought by
 *   that author (projects the layer contributes to via items).
 * `entityIds` (when non-null) prefilters to those project entities.
 */
export async function listProjects(
  userId: string,
  scope: ProjectCatalogScope,
  entityIds?: string[],
): Promise<ProjectListItem[]> {
  if (entityIds && entityIds.length === 0) return []

  if (scope.kind === 'authorLayer') {
    // Union in SQL: projects the layer authored OR projects linked to ≥1 of
    // the layer's thoughts (author-condition alone would drop user-created
    // projects the agent works on).
    const layerLinkedIds = await loadAuthorLayerLinkedProjectIds(userId, scope)
    const linkedCondition = layerLinkedIds.size
      ? inArray(canonicalEntity.id, [...layerLinkedIds])
      : undefined
    const rows = await loadProjectRows(
      userId,
      or(
        resolveAuthorSqlCondition(CANONICAL_ENTITY_AUTHOR_COLUMNS, {
          author: scope.author,
          authorLayerKey: scope.authorLayerKey ?? null,
        }),
        linkedCondition,
      ),
      entityIds,
    )
    return hydrateProjectListItems(userId, rows)
  }

  const projectRows = await loadProjectRows(userId, undefined, entityIds)

  if (scope.kind === 'all') {
    return hydrateProjectListItems(userId, projectRows)
  }

  const humanLinkedProjectIds = await loadHumanLinkedProjectEntityIds(
    userId,
    projectRows.map((row) => row.entityId),
  )

  const visibleProjectRows = projectRows.filter((row) => {
    const source = (row.source ?? 'capture') as ProjectSource
    if (isHumanOwnedProjectSource(source)) return true
    return humanLinkedProjectIds.has(row.entityId)
  })

  return hydrateProjectListItems(userId, visibleProjectRows)
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

/**
 * Listed-project entity IDs linked to at least one thought authored by the
 * given agent layer (API key or legacy label).
 */
async function loadAuthorLayerLinkedProjectIds(
  userId: string,
  scope: Extract<ProjectCatalogScope, { kind: 'authorLayer' }>,
): Promise<Set<string>> {
  const authorCondition = resolveAuthorSqlCondition(
    { author: thought.author, authorKeyId: thought.authorKeyId, authorLabel: thought.authorLabel },
    { author: scope.author, authorLayerKey: scope.authorLayerKey ?? null },
  )

  const rows = await getDb()
    .selectDistinct({ entityId: thoughtEntity.entityId })
    .from(thoughtEntity)
    .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(canonicalEntity.userId, userId),
        isNotNull(canonicalEntity.projectStatus),
        inArray(canonicalEntity.projectStatus, ['active', 'someday']),
        authorCondition,
      ),
    )

  return new Set(rows.map((row) => row.entityId))
}

/** Load a project's open-task count, task waterfall, milestones, and next action. */
async function hydrateProjectListItems(
  userId: string,
  rows: {
    entityId: string
    label: string
    status: string | null
    source: string | null
    nextActionThoughtId: string | null
    targetDate: Date | null
  }[],
): Promise<ProjectListItem[]> {
  const items: ProjectListItem[] = []
  for (const row of rows) {
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

export async function listProjectsForUser(
  userId: string,
  options?: ListProjectsOptions,
): Promise<ProjectListItem[]> {
  const scope: ProjectCatalogScope =
    options?.authorScope === 'all' ? { kind: 'all' } : { kind: 'user' }
  return listProjects(userId, scope)
}

export type ListProjectsOptions = {
  authorScope?: MemoryAuthor | 'all'
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
 * Load catalog rows for specific project entity IDs (unscoped detail join).
 * Returns only IDs that are still listed GTD projects (active/someday).
 */
export async function listProjectsByEntityIds(
  userId: string,
  entityIds: string[],
): Promise<ProjectListItem[]> {
  return listProjects(userId, { kind: 'all' }, entityIds)
}

export { auditGtdProjectProfiles }
