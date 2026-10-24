import { inArray, type SQL } from 'drizzle-orm'
import { thoughtEntity, type ThoughtEntitySource } from '$lib/server/db/schema'

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
