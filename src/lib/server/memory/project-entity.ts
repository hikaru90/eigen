import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity } from '$lib/server/db/schema'
import { upsertEntityNode } from '$lib/server/graph/age'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { loadProjectEntityRow } from '$lib/server/memory/project-eligibility'

const DEFAULT_HUB_ENTITY_TYPE = 'organization'

/** Create or update a graph hub entity without promoting to GTD project. */
export async function upsertGraphHubEntity(
  userId: string,
  name: string,
  entityType: string = DEFAULT_HUB_ENTITY_TYPE,
): Promise<string> {
  const label = name.trim()
  if (!label) {
    throw new Error('upsertGraphHubEntity: name is required')
  }
  const kind = entityType.trim() || DEFAULT_HUB_ENTITY_TYPE
  const canonicalKey = computeLexicalText(label)
  const [existing] = await getDb()
    .select({ id: canonicalEntity.id, entityType: canonicalEntity.entityType })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.canonicalKey, canonicalKey)))
    .limit(1)

  if (existing) {
    const nextType = existing.entityType === 'project' ? 'project' : kind
    await getDb()
      .update(canonicalEntity)
      .set({ label, entityType: nextType })
      .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, existing.id)))
    await upsertEntityNode({
      id: existing.id,
      userId,
      canonicalKey,
      label,
      entityType: nextType,
    })
    return existing.id
  }

  const [created] = await getDb()
    .insert(canonicalEntity)
    .values({
      userId,
      canonicalKey,
      label,
      entityType: kind,
    })
    .returning({ id: canonicalEntity.id })

  if (!created) {
    throw new Error('upsertGraphHubEntity: insert returned no row')
  }

  await upsertEntityNode({
    id: created.id,
    userId,
    canonicalKey,
    label,
    entityType: kind,
  })

  return created.id
}

/** Mark a hub as the GTD project entity type in Postgres + AGE. */
export async function promoteHubEntityType(
  userId: string,
  entityId: string,
  label: string,
): Promise<void> {
  const canonicalKey = computeLexicalText(label)
  const projectRow = await loadProjectEntityRow(userId, entityId)
  await getDb()
    .update(canonicalEntity)
    .set({ entityType: 'project', label: label.trim() })
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, entityId)))
  await upsertEntityNode({
    id: entityId,
    userId,
    canonicalKey,
    label: label.trim(),
    entityType: 'project',
    projectStatus: projectRow?.projectStatus ?? null,
    projectSource: projectRow?.projectSource ?? null,
  })
}

/** @deprecated Use upsertGraphHubEntity + promoteHubEntityType after eligibility checks. */
export async function upsertProjectEntity(userId: string, name: string): Promise<string> {
  const entityId = await upsertGraphHubEntity(userId, name, 'project')
  await promoteHubEntityType(userId, entityId, name)
  return entityId
}
