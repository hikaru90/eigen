import { and, eq } from 'drizzle-orm'
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { temporalEvent, thought, type LifecycleStatus } from '$lib/server/db/schema'
import { removeThoughtGraphArtifacts, upsertThoughtNode } from '$lib/server/graph/age'
import { graphAuthorProperty } from '$lib/server/memory/authorship'
import {
  cancelReminderSchedulesForEvent,
  syncReminderScheduleForEvent,
} from '$lib/server/memory/event-reminder-schedule'
import { clearNextActionIfCompleted } from '$lib/server/memory/project-next-action'
import {
  getTemporalEventListItemById,
  thoughtIdFromTaskItemId,
} from '$lib/server/memory/temporal-event-list'
import { ensureUserOntologySeeded } from '$lib/server/ontology-db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type LifecycleTarget = { kind: 'thought'; id: string } | { kind: 'event'; id: string }

export type SetLifecycleResult =
  | { ok: false; reason: 'not_found' }
  | { ok: true; kind: 'thought'; thought: Awaited<ReturnType<typeof loadThoughtCaptureResult>> }
  | {
      ok: true
      kind: 'event'
      item: NonNullable<Awaited<ReturnType<typeof getTemporalEventListItemById>>>
      summary: string
    }

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Resolve a timeline item id, thought uuid, or task:{uuid} to a lifecycle target row. */
export async function resolveLifecycleTarget(
  userId: string,
  itemId: string,
): Promise<LifecycleTarget | null> {
  const trimmed = itemId.trim()
  if (!trimmed) return null

  const taskThoughtId = thoughtIdFromTaskItemId(trimmed)
  if (taskThoughtId) {
    const [row] = await getDb()
      .select({ id: thought.id })
      .from(thought)
      .where(and(eq(thought.id, taskThoughtId), eq(thought.userId, userId)))
      .limit(1)
    return row ? { kind: 'thought', id: row.id } : null
  }

  if (!isUuid(trimmed)) return null

  const [eventRow] = await getDb()
    .select({ id: temporalEvent.id })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.id, trimmed), eq(temporalEvent.userId, userId)))
    .limit(1)
  if (eventRow) return { kind: 'event', id: eventRow.id }

  const [thoughtRow] = await getDb()
    .select({ id: thought.id })
    .from(thought)
    .where(and(eq(thought.id, trimmed), eq(thought.userId, userId)))
    .limit(1)
  if (thoughtRow) return { kind: 'thought', id: thoughtRow.id }

  return null
}

/** Archived/completed thoughts leave the AGE graph; reopen restores the anchor node only. */
async function applyThoughtGraphForLifecycleStatus(input: {
  userId: string
  thoughtId: string
  category: string
  status: LifecycleStatus
}): Promise<void> {
  if (input.status === 'completed' || input.status === 'archived') {
    const temporalRows = await getDb()
      .select({ id: temporalEvent.id, graphNodeId: temporalEvent.graphNodeId })
      .from(temporalEvent)
      .where(
        and(eq(temporalEvent.userId, input.userId), eq(temporalEvent.thoughtId, input.thoughtId)),
      )
    const temporalEventGraphIds = temporalRows.map((row) => row.graphNodeId?.trim() || row.id)
    await removeThoughtGraphArtifacts({
      userId: input.userId,
      thoughtId: input.thoughtId,
      temporalEventGraphIds,
    })
    return
  }

  const [authorshipRow] = await getDb()
    .select({
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
    })
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)

  await upsertThoughtNode({
    id: input.thoughtId,
    userId: input.userId,
    category: input.category,
    author: graphAuthorProperty({
      author: authorshipRow?.author ?? 'user',
      authorLabel: authorshipRow?.authorLabel ?? null,
      authorKeyId: authorshipRow?.authorKeyId ?? null,
    }),
  })
}

async function cascadeLifecycleToChildEvents(
  userId: string,
  thoughtId: string,
  status: LifecycleStatus,
): Promise<void> {
  const now = new Date()
  const childRows = await getDb()
    .select({ id: temporalEvent.id, kind: temporalEvent.kind, startAt: temporalEvent.startAt })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, thoughtId)))

  for (const row of childRows) {
    await getDb()
      .update(temporalEvent)
      .set({
        lifecycleStatus: status,
        lifecycleUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(temporalEvent.id, row.id))

    if (status === 'open' && row.startAt) {
      await syncReminderScheduleForEvent({
        userId,
        temporalEventId: row.id,
        kind: row.kind,
        startAt: row.startAt,
        lifecycleStatus: status,
      })
    } else {
      await cancelReminderSchedulesForEvent(row.id)
    }
  }
}

function lifecycleSummary(status: LifecycleStatus, preview: string): string {
  switch (status) {
    case 'completed':
      return `Marked as completed: "${preview}${preview.length >= 120 ? '…' : ''}"`
    case 'archived':
      return `Archived: "${preview}${preview.length >= 120 ? '…' : ''}"`
    default:
      return 'Reopened'
  }
}

/** Set lifecycle on a thought and cascade to all child temporal events. */
export async function setThoughtLifecycleStatus(
  userId: string,
  thoughtId: string,
  status: LifecycleStatus,
) {
  await ensureUserOntologySeeded(getDb(), userId)

  const [existing] = await getDb()
    .select()
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!existing) {
    return { ok: false as const, reason: 'not_found' as const }
  }

  const metadataJson = existing.metadataEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'metadata',
        ciphertext: existing.metadataEncrypted,
      })
    : JSON.stringify(existing.metadata ?? {})
  const priorMeta = JSON.parse(metadataJson) as Record<string, unknown>
  const normalizedPreview = existing.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: existing.normalizedTextEncrypted,
      })
    : existing.normalizedText
  const summary = lifecycleSummary(status, normalizedPreview.slice(0, 120))

  const now = new Date()
  const metadataPatch: Record<string, unknown> = {
    ...priorMeta,
    lastEditRequest:
      status === 'completed' ? 'mark as completed' : status === 'archived' ? 'archive' : 'reopen',
    lastEditSummary: summary,
    status,
  }
  if (status === 'completed') {
    metadataPatch.completedAt = now.toISOString()
  } else {
    delete metadataPatch.completedAt
  }

  const [updated] = await getDb()
    .update(thought)
    .set({
      lifecycleStatus: status,
      lifecycleUpdatedAt: now,
      lifecycleCompletedAt: status === 'completed' ? now : null,
      metadata: metadataPatch,
      metadataEncrypted: await encryptTenantValue({
        userId,
        table: 'thought',
        column: 'metadata',
        plaintext: JSON.stringify(metadataPatch),
      }),
      updatedAt: now,
    })
    .where(eq(thought.id, thoughtId))
    .returning({
      id: thought.id,
      category: thought.category,
    })

  if (!updated) {
    throw new Error(`setThoughtLifecycleStatus: persist returned no row for thought ${thoughtId}`)
  }

  await cascadeLifecycleToChildEvents(userId, thoughtId, status)

  console.info('[lifecycle.thought] graph sync', { userId, thoughtId, status })
  await applyThoughtGraphForLifecycleStatus({
    userId,
    thoughtId: updated.id,
    category: updated.category,
    status,
  })

  if (status === 'completed') {
    await clearNextActionIfCompleted(userId, thoughtId)
  }

  return {
    ok: true as const,
    thought: await loadThoughtCaptureResult(userId, thoughtId),
  }
}

/** Sync parent thought when it has exactly one temporal event sibling. */
export async function syncThoughtIfSingleEvent(
  userId: string,
  thoughtId: string,
  lifecycleStatus: LifecycleStatus,
): Promise<void> {
  const siblings = await getDb()
    .select({ id: temporalEvent.id })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.thoughtId, thoughtId), eq(temporalEvent.userId, userId)))

  if (siblings.length !== 1) return

  if (
    lifecycleStatus === 'completed' ||
    lifecycleStatus === 'archived' ||
    lifecycleStatus === 'open'
  ) {
    await setThoughtLifecycleStatus(userId, thoughtId, lifecycleStatus)
  }
}

/** Set lifecycle on a temporal event row; may sync parent thought when sole event. */
export async function setTemporalEventLifecycleStatus(
  userId: string,
  eventId: string,
  status: LifecycleStatus,
): Promise<SetLifecycleResult> {
  const [row] = await getDb()
    .select()
    .from(temporalEvent)
    .where(and(eq(temporalEvent.id, eventId), eq(temporalEvent.userId, userId)))
    .limit(1)

  if (!row) {
    return { ok: false, reason: 'not_found' }
  }

  const now = new Date()
  await getDb()
    .update(temporalEvent)
    .set({
      lifecycleStatus: status,
      lifecycleUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(temporalEvent.id, eventId))

  if (status === 'open' && row.startAt) {
    await syncReminderScheduleForEvent({
      userId,
      temporalEventId: eventId,
      kind: row.kind,
      startAt: row.startAt,
      lifecycleStatus: status,
    })
  } else {
    await cancelReminderSchedulesForEvent(eventId)
  }

  await syncThoughtIfSingleEvent(userId, row.thoughtId, status)

  const item = await getTemporalEventListItemById(userId, eventId)
  if (!item) {
    return { ok: false, reason: 'not_found' }
  }

  const summary =
    status === 'completed'
      ? `Marked "${row.semanticSummary}" as done.`
      : status === 'archived'
        ? `Archived "${row.semanticSummary}".`
        : `Reopened "${row.semanticSummary}".`

  return { ok: true, kind: 'event', item, summary }
}

/** Soft-remove alias used by delete_thought and timeline archive actions. */
export async function archiveThoughtForUser(userId: string, thoughtId: string) {
  return setThoughtLifecycleStatus(userId, thoughtId, 'archived')
}

/** Soft-remove a temporal event (or task via task: prefix) without deleting rows. */
export async function archiveTemporalEventForUser(userId: string, eventId: string) {
  const taskThoughtId = thoughtIdFromTaskItemId(eventId)
  if (taskThoughtId) {
    const result = await archiveThoughtForUser(userId, taskThoughtId)
    if (!result.ok) {
      throw new Error('Task not found')
    }
    return { ok: true as const, summary: 'Archived task.' }
  }

  const result = await setTemporalEventLifecycleStatus(userId, eventId, 'archived')
  if (!result.ok) {
    throw new Error('Event not found')
  }
  if (result.kind !== 'event') {
    throw new Error('Unexpected lifecycle result for temporal event')
  }
  return { ok: true as const, summary: result.summary }
}
