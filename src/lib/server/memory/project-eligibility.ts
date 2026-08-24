import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  thought,
  thoughtEntity,
  type ProjectSource,
  type ProjectStatus,
} from '$lib/server/db/schema'
import { upsertEntityNode } from '$lib/server/graph/age'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

const PROJECT_SOURCE_RANK: Record<ProjectSource, number> = {
  manual: 3,
  grounding: 2,
  capture: 1,
}

export function pickHigherProjectSource(
  current: ProjectSource | null | undefined,
  incoming: ProjectSource,
): ProjectSource {
  if (!current) return incoming
  return PROJECT_SOURCE_RANK[incoming] > PROJECT_SOURCE_RANK[current] ? incoming : current
}

export function isManualProjectSource(source: ProjectSource | null | undefined): boolean {
  return source === 'manual'
}

export function thoughtStatusFromMetadata(metadata: Record<string, unknown>): 'open' | 'completed' {
  return metadata.status === 'completed' ? 'completed' : 'open'
}

export async function countLinkedThoughtsForProjectEntity(
  userId: string,
  entityId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(distinct ${thoughtEntity.thoughtId})::int` })
    .from(thoughtEntity)
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, entityId)))
  return row?.count ?? 0
}

export async function countOpenTasksForProjectEntity(
  userId: string,
  projectEntityId: string,
): Promise<number> {
  const rows = await getDb()
    .select({
      thoughtId: thoughtEntity.thoughtId,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thoughtEntity)
    .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.entityId, projectEntityId),
        eq(thought.category, 'task'),
      ),
    )

  let count = 0
  for (const row of rows) {
    const metadataJson = row.metadataEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : JSON.stringify(row.metadata ?? {})
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>
    if (thoughtStatusFromMetadata(metadata) === 'open') count += 1
  }
  return count
}

export async function countGtdProjectsForUser(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), isNotNull(canonicalEntity.projectStatus)))
  return row?.count ?? 0
}

/** @deprecated Use countGtdProjectsForUser */
export const countGtdProjectProfilesForUser = countGtdProjectsForUser

export async function loadProjectEntityRow(
  userId: string,
  entityId: string,
): Promise<{
  id: string
  label: string
  canonicalKey: string
  entityType: string
  projectStatus: ProjectStatus | null
  projectSource: ProjectSource | null
} | null> {
  const id = validateNonEmptyEntityId(entityId, 'entityId')
  const [row] = await getDb()
    .select({
      id: canonicalEntity.id,
      label: canonicalEntity.label,
      canonicalKey: canonicalEntity.canonicalKey,
      entityType: canonicalEntity.entityType,
      projectStatus: canonicalEntity.projectStatus,
      projectSource: canonicalEntity.projectSource,
    })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, id)))
    .limit(1)
  if (!row) return null
  return {
    ...row,
    projectStatus: row.projectStatus as ProjectStatus | null,
    projectSource: row.projectSource as ProjectSource | null,
  }
}

async function syncProjectFieldsToGraph(input: {
  userId: string
  entityId: string
  canonicalKey: string
  label: string
  entityType: string
  projectStatus: ProjectStatus | null
  projectSource: ProjectSource | null
}): Promise<void> {
  await upsertEntityNode({
    id: input.entityId,
    userId: input.userId,
    canonicalKey: input.canonicalKey,
    label: input.label,
    entityType: input.entityType,
    projectStatus: input.projectStatus,
    projectSource: input.projectSource,
  })
}

/** Ensure a graph entity is a listed GTD project with protected provenance. */
export async function ensureProject(
  userId: string,
  projectEntityId: string,
  status: ProjectStatus = 'active',
  source: ProjectSource = 'capture',
): Promise<void> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const existing = await loadProjectEntityRow(userId, entityId)
  if (!existing) {
    throw new Error(`ensureProject: entity ${entityId} not found`)
  }

  const nextSource = pickHigherProjectSource(existing.projectSource, source)
  const nextStatus = existing.projectStatus ?? status
  const nextEntityType = existing.entityType === 'project' ? 'project' : 'project'

  await getDb()
    .update(canonicalEntity)
    .set({
      projectStatus: nextStatus,
      projectSource: nextSource,
      entityType: nextEntityType,
      updatedAt: new Date(),
    })
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, entityId)))

  await syncProjectFieldsToGraph({
    userId,
    entityId,
    canonicalKey: existing.canonicalKey,
    label: existing.label,
    entityType: nextEntityType,
    projectStatus: nextStatus,
    projectSource: nextSource,
  })
}

/** @deprecated Use ensureProject */
export const ensureProjectProfile = ensureProject

/** Clear GTD project listing from an entity. Manual projects are immune. */
export async function demoteProject(userId: string, entityId: string): Promise<boolean> {
  const id = validateNonEmptyEntityId(entityId, 'entityId')
  const existing = await loadProjectEntityRow(userId, id)
  if (!existing?.projectStatus) return false
  if (isManualProjectSource(existing.projectSource)) return false

  const nextEntityType = existing.entityType === 'project' ? 'organization' : existing.entityType
  await getDb()
    .update(canonicalEntity)
    .set({
      projectStatus: null,
      projectSource: null,
      nextActionThoughtId: null,
      projectDesignatedAt: null,
      entityType: nextEntityType,
      updatedAt: new Date(),
    })
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, id)))

  await syncProjectFieldsToGraph({
    userId,
    entityId: id,
    canonicalKey: existing.canonicalKey,
    label: existing.label,
    entityType: nextEntityType,
    projectStatus: null,
    projectSource: null,
  })
  return true
}

export async function restoreProjectListing(
  userId: string,
  entityId: string,
  status: ProjectStatus = 'active',
  source: ProjectSource = 'capture',
): Promise<void> {
  const existing = await loadProjectEntityRow(userId, entityId)
  if (!existing) return

  await getDb()
    .update(canonicalEntity)
    .set({
      projectStatus: status,
      projectSource: source,
      entityType: 'project',
      updatedAt: new Date(),
    })
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, entityId)))

  await syncProjectFieldsToGraph({
    userId,
    entityId,
    canonicalKey: existing.canonicalKey,
    label: existing.label,
    entityType: 'project',
    projectStatus: status,
    projectSource: source,
  })
}
