import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  thought,
  thoughtEntity,
  type MemoryAuthor,
  type ProjectSource,
  type ProjectStatus,
} from '$lib/server/db/schema'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { auditGtdProjectProfiles } from '$lib/server/memory/judge-gtd-project'
import { taskItemId } from '$lib/server/memory/temporal-event-list'
import {
  countOpenTasksForProjectEntity,
  ensureProject,
  thoughtStatusFromMetadata,
} from '$lib/server/memory/project-eligibility'

export type ProjectNextAction = {
  thoughtId: string
  summary: string
  itemId: string
}

export type ProjectListItem = {
  entityId: string
  label: string
  status: ProjectStatus
  source: ProjectSource
  nextAction: ProjectNextAction | null
  openTaskCount: number
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
    items.push({
      entityId: row.entityId,
      label: row.label,
      status,
      source,
      nextAction,
      openTaskCount,
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

/** Active GTD projects in the assignment catalog. */
export async function loadEligibleGtdProjects(userId: string): Promise<EligibleGtdProject[]> {
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
        eq(canonicalEntity.projectStatus, 'active'),
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

/** @deprecated Use loadEligibleGtdProjects for assignment catalog. */
export async function loadGtdProjectOptionsFromProfiles(userId: string) {
  return loadEligibleGtdProjects(userId)
}

export { auditGtdProjectProfiles }
