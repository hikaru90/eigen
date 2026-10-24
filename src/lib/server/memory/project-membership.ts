import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity, thoughtEntity, type ThoughtEntitySource } from '$lib/server/db/schema'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

/**
 * The two link sources that put a thought on a thread: the user's own assignment
 * (`manual`) and the enrich LLM's project decision (`project`). Plain `ingest` rows
 * are entity mentions materialized from entity_resolution_log — a thought that merely
 * mentions a project entity is not on that thread. Mention rows are rebuilt on every
 * materialization (materialize-links.ts); membership rows survive it.
 */
export const PROJECT_MEMBERSHIP_SOURCES = [
  'manual',
  'project',
] as const satisfies readonly ThoughtEntitySource[]

export type ProjectMembershipSource = (typeof PROJECT_MEMBERSHIP_SOURCES)[number]

/** `thought_entity` rows that are thread membership — for every reader that lists a thread's thoughts. */
export function projectMembershipLinkCondition(): SQL {
  return inArray(thoughtEntity.source, [...PROJECT_MEMBERSHIP_SOURCES])
}

/**
 * True when the thought already sits on a GTD-project thread (the user's pick or the
 * enrich LLM's decision). Detection must not add a second membership beside one.
 */
export async function thoughtHasProjectMembership(
  userId: string,
  thoughtId: string,
): Promise<boolean> {
  const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId')
  const [row] = await getDb()
    .select({ entityId: thoughtEntity.entityId })
    .from(thoughtEntity)
    .innerJoin(canonicalEntity, eq(thoughtEntity.entityId, canonicalEntity.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.thoughtId, tid),
        projectMembershipLinkCondition(),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * The project a user picked, when it exists and really is a GTD project of theirs.
 * A null answer means the pick is stale (project dismissed) or malformed — the caller
 * decides to fail; nothing here falls back to another project.
 */
export async function findGtdProjectForUser(
  userId: string,
  projectEntityId: string,
): Promise<{ entityId: string; label: string } | null> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const [row] = await getDb()
    .select({ id: canonicalEntity.id, label: canonicalEntity.label })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, userId),
        eq(canonicalEntity.id, entityId),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .limit(1)
  return row ? { entityId: row.id, label: row.label } : null
}
