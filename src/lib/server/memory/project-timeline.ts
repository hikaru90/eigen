import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  canonicalEntity,
  projectMilestone,
  temporalEvent,
  thought,
  thoughtEntity,
} from '$lib/server/db/schema'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import {
  extractProjectTimeline,
  type ProjectTimelineExtraction,
  type ProjectTimelineMilestone,
} from '$lib/server/memory/extract-project-timeline'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type ProjectMilestoneListItem = {
  id: string
  label: string
  targetDate: string | null
  rank: number
  completedAt: string | null
  linkedThoughtId: string | null
}

export async function listMilestonesForProject(
  userId: string,
  projectEntityId: string,
): Promise<ProjectMilestoneListItem[]> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
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
      and(eq(projectMilestone.userId, userId), eq(projectMilestone.projectEntityId, entityId)),
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

export async function setProjectDeadline(input: {
  userId: string
  projectEntityId: string
  targetDate: string | null
}): Promise<{ projectEntityId: string; targetDate: string | null }> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  let targetDate: Date | null = null
  if (input.targetDate !== null) {
    const ms = Date.parse(input.targetDate)
    if (!Number.isFinite(ms)) {
      throw new Error('setProjectDeadline: targetDate must be ISO-8601 or null')
    }
    targetDate = new Date(ms)
  }

  const [updated] = await getDb()
    .update(canonicalEntity)
    .set({ targetDate, updatedAt: new Date() })
    .where(
      and(
        eq(canonicalEntity.userId, input.userId),
        eq(canonicalEntity.id, entityId),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .returning({ id: canonicalEntity.id, targetDate: canonicalEntity.targetDate })

  if (!updated) {
    throw new Error('setProjectDeadline: GTD project not found for user')
  }

  return {
    projectEntityId: updated.id,
    targetDate: updated.targetDate ? updated.targetDate.toISOString() : null,
  }
}

export async function setProjectMilestone(input: {
  userId: string
  projectEntityId: string
  milestoneId?: string
  label: string
  targetDate?: string | null
  rank?: number
  linkedThoughtId?: string | null
  completed?: boolean
}): Promise<ProjectMilestoneListItem> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const label = input.label.trim()
  if (!label) throw new Error('setProjectMilestone: label is required')

  let targetDate: Date | null = null
  if (input.targetDate != null && input.targetDate !== '') {
    const ms = Date.parse(input.targetDate)
    if (!Number.isFinite(ms)) {
      throw new Error('setProjectMilestone: targetDate must be ISO-8601 or null')
    }
    targetDate = new Date(ms)
  }

  const linkedThoughtId =
    input.linkedThoughtId == null || input.linkedThoughtId === ''
      ? null
      : validateNonEmptyEntityId(input.linkedThoughtId, 'linkedThoughtId')

  const [project] = await getDb()
    .select({ id: canonicalEntity.id })
    .from(canonicalEntity)
    .where(
      and(
        eq(canonicalEntity.userId, input.userId),
        eq(canonicalEntity.id, entityId),
        isNotNull(canonicalEntity.projectStatus),
      ),
    )
    .limit(1)
  if (!project) throw new Error('setProjectMilestone: GTD project not found for user')

  const now = new Date()
  const completedAt = input.completed === true ? now : input.completed === false ? null : undefined

  if (input.milestoneId) {
    const milestoneId = validateNonEmptyEntityId(input.milestoneId, 'milestoneId')
    const [updated] = await getDb()
      .update(projectMilestone)
      .set({
        label,
        targetDate,
        ...(typeof input.rank === 'number' ? { rank: Math.max(1, Math.floor(input.rank)) } : {}),
        linkedThoughtId,
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(projectMilestone.userId, input.userId),
          eq(projectMilestone.projectEntityId, entityId),
          eq(projectMilestone.id, milestoneId),
        ),
      )
      .returning({
        id: projectMilestone.id,
        label: projectMilestone.label,
        targetDate: projectMilestone.targetDate,
        rank: projectMilestone.rank,
        completedAt: projectMilestone.completedAt,
        linkedThoughtId: projectMilestone.linkedThoughtId,
      })
    if (!updated) throw new Error('setProjectMilestone: milestone not found')
    return {
      id: updated.id,
      label: updated.label,
      targetDate: updated.targetDate ? updated.targetDate.toISOString() : null,
      rank: updated.rank,
      completedAt: updated.completedAt ? updated.completedAt.toISOString() : null,
      linkedThoughtId: updated.linkedThoughtId,
    }
  }

  const existing = await listMilestonesForProject(input.userId, entityId)
  const rank =
    typeof input.rank === 'number' && Number.isFinite(input.rank)
      ? Math.max(1, Math.floor(input.rank))
      : existing.length + 1

  const [inserted] = await getDb()
    .insert(projectMilestone)
    .values({
      userId: input.userId,
      projectEntityId: entityId,
      label,
      targetDate,
      rank,
      linkedThoughtId,
      completedAt: completedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: projectMilestone.id,
      label: projectMilestone.label,
      targetDate: projectMilestone.targetDate,
      rank: projectMilestone.rank,
      completedAt: projectMilestone.completedAt,
      linkedThoughtId: projectMilestone.linkedThoughtId,
    })

  return {
    id: inserted.id,
    label: inserted.label,
    targetDate: inserted.targetDate ? inserted.targetDate.toISOString() : null,
    rank: inserted.rank,
    completedAt: inserted.completedAt ? inserted.completedAt.toISOString() : null,
    linkedThoughtId: inserted.linkedThoughtId,
  }
}

export async function replaceProjectMilestones(input: {
  userId: string
  projectEntityId: string
  milestones: ProjectTimelineMilestone[]
}): Promise<void> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const now = new Date()
  await getDb().transaction(async (tx) => {
    await tx
      .delete(projectMilestone)
      .where(
        and(eq(projectMilestone.userId, input.userId), eq(projectMilestone.projectEntityId, entityId)),
      )
    if (input.milestones.length === 0) return
    await tx.insert(projectMilestone).values(
      input.milestones.map((m, index) => ({
        userId: input.userId,
        projectEntityId: entityId,
        label: m.label,
        targetDate: m.targetDate ? new Date(m.targetDate) : null,
        rank: index + 1,
        linkedThoughtId: m.linkedThoughtId,
        createdAt: now,
        updatedAt: now,
      })),
    )
  })
}

export async function persistProjectTimelineExtraction(input: {
  userId: string
  projectEntityId: string
  extraction: ProjectTimelineExtraction
}): Promise<void> {
  await setProjectDeadline({
    userId: input.userId,
    projectEntityId: input.projectEntityId,
    targetDate: input.extraction.targetDate,
  })
  await replaceProjectMilestones({
    userId: input.userId,
    projectEntityId: input.projectEntityId,
    milestones: input.extraction.milestones,
  })
}

export async function loadLinkedThoughtSummariesForProject(
  userId: string,
  projectEntityId: string,
): Promise<Array<{ thoughtId: string; summary: string }>> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const rows = await getDb()
    .select({
      thoughtId: thoughtEntity.thoughtId,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thoughtEntity)
    .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.entityId, entityId)))

  const out: Array<{ thoughtId: string; summary: string }> = []
  for (const row of rows) {
    const text = row.normalizedTextEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : row.normalizedText
    const trimmed = text.trim()
    if (!trimmed) continue
    out.push({
      thoughtId: row.thoughtId,
      summary: trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed,
    })
  }
  return out
}

export async function loadExistingDeadlinesForProject(
  userId: string,
  projectEntityId: string,
): Promise<Array<{ thoughtId: string; summary: string; startAt: string }>> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const rows = await getDb()
    .select({
      thoughtId: temporalEvent.thoughtId,
      semanticSummary: temporalEvent.semanticSummary,
      startAt: temporalEvent.startAt,
    })
    .from(temporalEvent)
    .innerJoin(thoughtEntity, eq(temporalEvent.thoughtId, thoughtEntity.thoughtId))
    .where(
      and(
        eq(temporalEvent.userId, userId),
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.entityId, entityId),
        eq(temporalEvent.kind, 'deadline'),
      ),
    )

  return rows
    .filter((r) => r.startAt)
    .map((r) => ({
      thoughtId: r.thoughtId,
      summary: r.semanticSummary,
      startAt: r.startAt!.toISOString(),
    }))
}

export async function refreshProjectTimelineFromLlm(input: {
  userId: string
  projectEntityId: string
  projectLabel: string
}): Promise<ProjectTimelineExtraction> {
  const linkedThoughts = await loadLinkedThoughtSummariesForProject(
    input.userId,
    input.projectEntityId,
  )
  const existingDeadlines = await loadExistingDeadlinesForProject(
    input.userId,
    input.projectEntityId,
  )
  const extraction = await extractProjectTimeline({
    userId: input.userId,
    projectLabel: input.projectLabel,
    linkedThoughts,
    existingDeadlines,
  })
  await persistProjectTimelineExtraction({
    userId: input.userId,
    projectEntityId: input.projectEntityId,
    extraction,
  })
  return extraction
}
