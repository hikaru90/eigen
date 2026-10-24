import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity, temporalEvent, thoughtEntity } from '$lib/server/db/schema'
import { deleteMentionEdge } from '$lib/server/graph/age'
import { promoteEntityToProject } from '$lib/server/memory/maybe-promote-gtd-project'
import { ensureProject } from '$lib/server/memory/project-eligibility'
import { promoteHubEntityType } from '$lib/server/memory/project-entity'
import { loadProjectMembershipEntityIds } from '$lib/server/memory/project-membership'
import {
  clearNextActionIfCompleted,
  designateNextAction,
  linkThoughtToProject,
} from '$lib/server/memory/project-next-action'
import { resolveProjectIdentity } from '$lib/server/memory/resolve-project-identity'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type AssignThoughtProjectInput = { projectEntityId: string } | { projectLabel: string }

export type AssignThoughtProjectResult = {
  projectEntityId: string
  projectLabel: string
  eligible: boolean
  created: boolean
  isGtdProject: boolean
}

export type UnassignThoughtProjectResult = {
  removedEntityIds: string[]
}

export async function assignThoughtToProject(
  userId: string,
  thoughtId: string,
  target: AssignThoughtProjectInput,
): Promise<AssignThoughtProjectResult> {
  const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId')
  let projectEntityId: string
  let projectLabel: string
  let created = false

  if ('projectEntityId' in target) {
    projectEntityId = validateNonEmptyEntityId(target.projectEntityId, 'projectEntityId')
    const [entity] = await getDb()
      .select({
        id: canonicalEntity.id,
        label: canonicalEntity.label,
      })
      .from(canonicalEntity)
      .where(
        and(
          eq(canonicalEntity.userId, userId),
          eq(canonicalEntity.id, projectEntityId),
          isNotNull(canonicalEntity.projectStatus),
        ),
      )
      .limit(1)
    if (!entity) {
      throw new Error(`assignThoughtToProject: eligible project ${projectEntityId} not found`)
    }
    projectLabel = entity.label
  } else {
    const label = target.projectLabel.trim()
    if (!label) {
      throw new Error('assignThoughtToProject: projectLabel is required')
    }

    const resolution = await resolveProjectIdentity({
      userId,
      surfaceLabel: label,
      thoughtId: tid,
      mode: 'assign',
    })
    projectEntityId = resolution.entityId
    projectLabel = resolution.canonicalLabel
    created = resolution.shouldCreateHub
  }

  await linkThoughtToProject(userId, projectEntityId, tid, 'manual')

  const [entity] = await getDb()
    .select({ nextActionThoughtId: canonicalEntity.nextActionThoughtId })
    .from(canonicalEntity)
    .where(and(eq(canonicalEntity.userId, userId), eq(canonicalEntity.id, projectEntityId)))
    .limit(1)

  if (!entity?.nextActionThoughtId) {
    const [eventRow] = await getDb()
      .select({ startAt: temporalEvent.startAt })
      .from(temporalEvent)
      .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, tid)))
      .limit(1)

    if (eventRow?.startAt) {
      await designateNextAction(userId, projectEntityId, tid)
    }
  }

  let isGtdProject: boolean
  if ('projectEntityId' in target) {
    isGtdProject = await promoteEntityToProject({
      userId,
      entityId: projectEntityId,
      source: 'manual',
      forceJudge: true,
    })
  } else {
    // Manual declaration: the user is the judge. Create as a manual project
    // so the GTD LLM judge cannot veto an explicit assignment.
    await promoteHubEntityType(userId, projectEntityId, projectLabel)
    await ensureProject(userId, projectEntityId, 'active', 'manual')
    isGtdProject = true
  }

  return {
    projectEntityId,
    projectLabel,
    eligible: isGtdProject,
    created,
    isGtdProject,
  }
}

/**
 * The thought leaves every thread it is on: membership rows are removed (a plain
 * mention of the same project may remain — that is not membership), the graph twin
 * edge goes with them, and a project whose next action just left picks its next
 * open task. An already-loose thought is a no-op, not an error.
 */
export async function unassignThoughtFromProject(
  userId: string,
  thoughtId: string,
): Promise<UnassignThoughtProjectResult> {
  const tid = validateNonEmptyEntityId(thoughtId, 'thoughtId')
  const removedEntityIds = await loadProjectMembershipEntityIds(userId, tid)
  if (removedEntityIds.length === 0) {
    return { removedEntityIds: [] }
  }

  await getDb()
    .delete(thoughtEntity)
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.thoughtId, tid),
        inArray(thoughtEntity.entityId, removedEntityIds),
      ),
    )

  for (const entityId of removedEntityIds) {
    await deleteMentionEdge({ userId, thoughtId: tid, entityId })
  }

  // the removed thought can no longer be a project's next action — re-pick from the
  // waterfall (the membership rows are gone, so the thought is out of every candidate set)
  await clearNextActionIfCompleted(userId, tid)

  return { removedEntityIds }
}
