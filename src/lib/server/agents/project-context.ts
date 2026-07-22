import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thoughtEntity } from '$lib/server/db/schema'

export type ProjectContext = {
  projectEntityIds: string[]
  projectLabels: string[]
}

export async function loadProjectContextForThought(
  userId: string,
  thoughtId: string,
): Promise<ProjectContext> {
  const db = getDb()

  const rows = await db
    .select({
      projectEntityId: canonicalEntity.id,
      label: canonicalEntity.label,
    })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(canonicalEntity.id, thoughtEntity.entityId))
    .where(
      and(
        eq(thoughtEntity.thoughtId, thoughtId),
        eq(thoughtEntity.userId, userId),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )

  return {
    projectEntityIds: rows.map((r) => r.projectEntityId),
    projectLabels: rows.map((r) => r.label),
  }
}

export async function loadProjectContextForThoughts(
  userId: string,
  thoughtIds: string[],
): Promise<Map<string, ProjectContext>> {
  if (thoughtIds.length === 0) return new Map()

  const db = getDb()
  const result = new Map<string, ProjectContext>()

  const rows = await db
    .select({
      thoughtId: thoughtEntity.thoughtId,
      projectEntityId: canonicalEntity.id,
      label: canonicalEntity.label,
    })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(canonicalEntity.id, thoughtEntity.entityId))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        inArray(thoughtEntity.thoughtId, thoughtIds),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )

  for (const row of rows) {
    let ctx = result.get(row.thoughtId)
    if (!ctx) {
      ctx = { projectEntityIds: [], projectLabels: [] }
      result.set(row.thoughtId, ctx)
    }
    ctx.projectEntityIds.push(row.projectEntityId)
    ctx.projectLabels.push(row.label)
  }

  return result
}
