import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { canonicalEntity, temporalEvent } from '$lib/server/db/schema'
import { promoteEntityToProject } from '$lib/server/memory/maybe-promote-gtd-project'
import { designateNextAction, linkThoughtToProject } from '$lib/server/memory/project-next-action'
import { promoteHubEntityType } from '$lib/server/memory/project-entity'
import { ensureProject } from '$lib/server/memory/project-eligibility'
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
