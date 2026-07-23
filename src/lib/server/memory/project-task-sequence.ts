import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  projectTaskSequence,
  thought,
  thoughtEntity,
  type LifecycleStatus,
} from '$lib/server/db/schema'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { thoughtStatusFromMetadata } from '$lib/server/memory/project-eligibility'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export function computeReorderedThoughtIds(input: {
  currentOrder: string[]
  thoughtId: string
  afterThoughtId?: string | null
  rank?: number
}): string[] {
  const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId')
  const without = input.currentOrder.filter((id) => id !== thoughtId)

  if (typeof input.rank === 'number' && Number.isFinite(input.rank)) {
    const idx = Math.max(0, Math.min(without.length, Math.floor(input.rank) - 1))
    const next = [...without]
    next.splice(idx, 0, thoughtId)
    return next
  }

  if (input.afterThoughtId === null) {
    return [...without, thoughtId]
  }

  if (typeof input.afterThoughtId === 'string' && input.afterThoughtId.trim()) {
    const afterId = validateNonEmptyEntityId(input.afterThoughtId, 'afterThoughtId')
    const afterIdx = without.indexOf(afterId)
    if (afterIdx >= 0) {
      const next = [...without]
      next.splice(afterIdx + 1, 0, thoughtId)
      return next
    }
  }

  return [...without, thoughtId]
}

export function selectNextOpenThoughtAfterCompleted(input: {
  orderedThoughtIds: string[]
  completedThoughtId: string
  openThoughtIds: Set<string>
}): string | null {
  const completedIdx = input.orderedThoughtIds.indexOf(input.completedThoughtId)
  if (completedIdx >= 0) {
    for (let i = completedIdx + 1; i < input.orderedThoughtIds.length; i++) {
      const id = input.orderedThoughtIds[i]
      if (id && input.openThoughtIds.has(id)) return id
    }
    return null
  }
  for (const id of input.orderedThoughtIds) {
    if (input.openThoughtIds.has(id)) return id
  }
  return null
}

export async function loadOrderedThoughtIdsForProject(
  userId: string,
  projectEntityId: string,
): Promise<string[]> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const rows = await getDb()
    .select({
      thoughtId: projectTaskSequence.thoughtId,
      rank: projectTaskSequence.rank,
    })
    .from(projectTaskSequence)
    .where(
      and(
        eq(projectTaskSequence.userId, userId),
        eq(projectTaskSequence.projectEntityId, entityId),
      ),
    )
    .orderBy(asc(projectTaskSequence.rank))
  return rows.map((r) => r.thoughtId)
}

export async function loadOpenTaskThoughtIdsForProject(
  userId: string,
  projectEntityId: string,
): Promise<Set<string>> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const rows = await getDb()
    .select({
      thoughtId: thoughtEntity.thoughtId,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
    })
    .from(thoughtEntity)
    .innerJoin(thought, eq(thoughtEntity.thoughtId, thought.id))
    .where(
      and(
        eq(thoughtEntity.userId, userId),
        eq(thoughtEntity.entityId, entityId),
        eq(thought.category, 'task'),
      ),
    )

  const open = new Set<string>()
  for (const row of rows) {
    const lifecycle = row.lifecycleStatus as LifecycleStatus
    if (lifecycle === 'completed' || lifecycle === 'archived') continue
    const metadataJson = row.metadataEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : JSON.stringify(row.metadata ?? {})
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>
    if (thoughtStatusFromMetadata(metadata) === 'open') {
      open.add(row.thoughtId)
    }
  }
  return open
}

export async function replaceProjectTaskSequence(input: {
  userId: string
  projectEntityId: string
  orderedThoughtIds: string[]
}): Promise<void> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const ordered = input.orderedThoughtIds.map((id) =>
    validateNonEmptyEntityId(id, 'thoughtId'),
  )
  const now = new Date()
  await getDb().transaction(async (tx) => {
    await tx
      .delete(projectTaskSequence)
      .where(
        and(
          eq(projectTaskSequence.userId, input.userId),
          eq(projectTaskSequence.projectEntityId, entityId),
        ),
      )
    if (ordered.length === 0) return
    await tx.insert(projectTaskSequence).values(
      ordered.map((thoughtId, index) => ({
        userId: input.userId,
        projectEntityId: entityId,
        thoughtId,
        rank: index + 1,
        createdAt: now,
        updatedAt: now,
      })),
    )
  })
}

export async function orderTaskInProject(input: {
  userId: string
  projectEntityId: string
  thoughtId: string
  afterThoughtId?: string | null
  rank?: number
}): Promise<{ projectEntityId: string; orderedThoughtIds: string[] }> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const thoughtId = validateNonEmptyEntityId(input.thoughtId, 'thoughtId')
  const current = await loadOrderedThoughtIdsForProject(input.userId, entityId)
  const orderedThoughtIds = computeReorderedThoughtIds({
    currentOrder: current,
    thoughtId,
    afterThoughtId: input.afterThoughtId,
    rank: input.rank,
  })
  await replaceProjectTaskSequence({
    userId: input.userId,
    projectEntityId: entityId,
    orderedThoughtIds,
  })
  return { projectEntityId: entityId, orderedThoughtIds }
}

export async function pruneCompletedFromProjectSequences(
  userId: string,
  projectEntityId: string,
): Promise<void> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const open = await loadOpenTaskThoughtIdsForProject(userId, entityId)
  const current = await loadOrderedThoughtIdsForProject(userId, entityId)
  const pruned = current.filter((id) => open.has(id))
  if (pruned.length === current.length) return
  await replaceProjectTaskSequence({
    userId,
    projectEntityId: entityId,
    orderedThoughtIds: pruned,
  })
}

export async function pruneCompletedSequencesForUser(userId: string): Promise<void> {
  const projectIds = await getDb()
    .selectDistinct({ projectEntityId: projectTaskSequence.projectEntityId })
    .from(projectTaskSequence)
    .where(eq(projectTaskSequence.userId, userId))

  for (const row of projectIds) {
    await pruneCompletedFromProjectSequences(userId, row.projectEntityId)
  }
}

export async function loadOpenTaskSummariesForProject(
  userId: string,
  projectEntityId: string,
): Promise<Array<{ thoughtId: string; summary: string }>> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const openIds = [...(await loadOpenTaskThoughtIdsForProject(userId, entityId))]
  if (openIds.length === 0) return []

  const rows = await getDb()
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.userId, userId), inArray(thought.id, openIds)))

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
      thoughtId: row.id,
      summary: trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed,
    })
  }
  return out
}
