import { and, eq } from 'drizzle-orm'
import { editStoredThought } from '$lib/server/capture/service'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  graphSyncJob,
  temporalEvent,
  thought,
  type GraphSyncJobOperation,
  type LifecycleStatus,
} from '$lib/server/db/schema'
import { processPendingGraphSyncJobs } from '$lib/server/graph/graph-sync-worker'
import {
  applyTemporalEventActionRequest,
  normalizeTemporalEventQuickAction,
  quickActionToLifecycle,
  type AppliedTemporalEventAction,
  type TemporalEventActionInput,
} from '$lib/server/memory/apply-temporal-event-action'
import {
  cancelReminderSchedulesForEvent,
  syncReminderScheduleForEvent,
} from '$lib/server/memory/event-reminder-schedule'
import {
  archiveTemporalEventForUser,
  setThoughtLifecycleStatus,
  syncThoughtIfSingleEvent,
} from '$lib/server/memory/lifecycle'
import {
  getTemporalEventListItemById,
  thoughtIdFromTaskItemId,
  type TemporalEventListItem,
} from '$lib/server/memory/temporal-event-list'
import { buildActivePeriodLiteral } from '$lib/server/memory/temporal-normalize'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

export type TemporalEventActionResult = {
  ok: true
  item: TemporalEventListItem
  summary: string
}

async function loadEventRow(userId: string, eventId: string) {
  const [row] = await getDb()
    .select()
    .from(temporalEvent)
    .where(and(eq(temporalEvent.id, eventId), eq(temporalEvent.userId, userId)))
    .limit(1)
  return row ?? null
}

async function loadListItem(
  userId: string,
  eventId: string,
): Promise<TemporalEventListItem | null> {
  return getTemporalEventListItemById(userId, eventId)
}

function isTaskEventId(eventId: string): boolean {
  return thoughtIdFromTaskItemId(eventId) !== null
}

function extractThoughtIdFromTaskEvent(eventId: string): string | null {
  return thoughtIdFromTaskItemId(eventId)
}

function resolveBoundsFromPatch(
  current: { startAt: Date | null; endAt: Date | null },
  patch: AppliedTemporalEventAction,
): { startAt: Date | null; endAt: Date | null; activePeriodLiteral: string | null } {
  let startAt = current.startAt
  let endAt = current.endAt

  if (patch.startAt !== undefined) {
    startAt = patch.startAt ? new Date(patch.startAt) : null
  }
  if (patch.endAt !== undefined) {
    endAt = patch.endAt ? new Date(patch.endAt) : null
  }

  if (startAt && Number.isNaN(startAt.getTime())) {
    throw new Error('Invalid startAt from action')
  }
  if (endAt && Number.isNaN(endAt.getTime())) {
    throw new Error('Invalid endAt from action')
  }

  if (!startAt) {
    return { startAt: null, endAt: null, activePeriodLiteral: null }
  }

  const resolvedEnd = endAt ?? new Date(startAt.getTime() + 60 * 60 * 1000)
  return {
    startAt,
    endAt: resolvedEnd,
    activePeriodLiteral: buildActivePeriodLiteral(startAt, resolvedEnd),
  }
}

async function enqueueGraphUpsert(
  userId: string,
  eventId: string,
  thoughtId: string,
  kind: string,
  semanticSummary: string,
  startAt: Date | null,
  endAt: Date | null,
): Promise<void> {
  if (!startAt || !endAt) return

  const payload = {
    temporalEventId: eventId,
    thoughtId,
    kind,
    semanticSummary,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  }

  const [job] = await getDb()
    .insert(graphSyncJob)
    .values({
      userId,
      temporalEventId: eventId,
      operation: 'upsert_temporal_event' satisfies GraphSyncJobOperation,
      payload,
    })
    .returning({ id: graphSyncJob.id })

  void processPendingGraphSyncJobs({ userId, jobIds: [job.id] }).catch((err) => {
    console.error('[temporal-event-service] graph sync failed', {
      eventId,
      message: err instanceof Error ? err.message : String(err),
    })
  })
}

async function applyLifecycleAndBoundsPatch(
  userId: string,
  eventId: string,
  patch: AppliedTemporalEventAction,
): Promise<{ summary: string }> {
  const row = await loadEventRow(userId, eventId)
  if (!row) {
    return { summary: '' }
  }

  const nextLifecycle = patch.lifecycleStatus ?? row.lifecycleStatus
  const bounds = resolveBoundsFromPatch({ startAt: row.startAt, endAt: row.endAt }, patch)

  const snoozedUntil =
    patch.snoozedUntil === null
      ? null
      : patch.snoozedUntil
        ? new Date(patch.snoozedUntil)
        : row.snoozedUntil

  if (snoozedUntil && Number.isNaN(snoozedUntil.getTime())) {
    throw new Error('Invalid snoozedUntil from action')
  }

  const now = new Date()

  const parseMetadata = {
    ...(row.parseMetadata as Record<string, unknown>),
    ...(bounds.startAt
      ? {
          startAt: bounds.startAt.toISOString(),
          endAt: bounds.endAt?.toISOString() ?? null,
        }
      : {}),
  }

  await getDb()
    .update(temporalEvent)
    .set({
      lifecycleStatus: nextLifecycle,
      lifecycleUpdatedAt: now,
      snoozedUntil,
      ...(bounds.activePeriodLiteral
        ? {
            activePeriod: bounds.activePeriodLiteral,
            startAt: bounds.startAt,
            endAt: bounds.endAt,
            parseMetadata,
            graphSyncStatus: 'pending',
          }
        : {}),
      updatedAt: now,
    })
    .where(eq(temporalEvent.id, eventId))

  await syncThoughtIfSingleEvent(userId, row.thoughtId, nextLifecycle)

  if (bounds.startAt && bounds.endAt) {
    await enqueueGraphUpsert(
      userId,
      eventId,
      row.thoughtId,
      row.kind,
      row.semanticSummary,
      bounds.startAt,
      bounds.endAt,
    )
  }

  if (nextLifecycle === 'open' && bounds.startAt) {
    await syncReminderScheduleForEvent({
      userId,
      temporalEventId: eventId,
      kind: row.kind,
      startAt: bounds.startAt,
      lifecycleStatus: nextLifecycle,
    })
  } else {
    await cancelReminderSchedulesForEvent(eventId)
  }

  return { summary: patch.summary }
}

export async function applyQuickTemporalEventAction(
  userId: string,
  eventId: string,
  action: TemporalEventActionInput,
): Promise<TemporalEventActionResult> {
  const quickAction = normalizeTemporalEventQuickAction(action)

  if (isTaskEventId(eventId)) {
    const thoughtId = extractThoughtIdFromTaskEvent(eventId)
    if (!thoughtId) throw new Error('Invalid task event ID')

    const status: LifecycleStatus =
      quickAction === 'mark_done' ? 'completed' : quickAction === 'archive' ? 'archived' : 'open'
    const result = await setThoughtLifecycleStatus(userId, thoughtId, status)
    if (!result.ok) throw new Error('Task not found')

    const item = await loadListItem(userId, eventId)
    if (!item) throw new Error('Task not found after update')

    const summary =
      quickAction === 'mark_done'
        ? `Marked "${item.semanticSummary}" as done.`
        : quickAction === 'archive'
          ? `Archived "${item.semanticSummary}".`
          : `Reopened "${item.semanticSummary}".`

    return { ok: true, item, summary }
  }

  const row = await loadEventRow(userId, eventId)
  if (!row) {
    throw new Error('Event not found')
  }

  const lifecycleStatus = quickActionToLifecycle(quickAction)
  const summaries: Record<typeof quickAction, string> = {
    mark_done: `Marked "${row.semanticSummary}" as done.`,
    reopen: `Reopened "${row.semanticSummary}".`,
    archive: `Archived "${row.semanticSummary}".`,
  }

  await applyLifecycleAndBoundsPatch(userId, eventId, {
    action: quickAction,
    lifecycleStatus,
    summary: summaries[quickAction],
  })

  const item = await loadListItem(userId, eventId)
  if (!item) throw new Error('Event not found after update')

  return { ok: true, item, summary: summaries[quickAction] }
}

export async function applyNlTemporalEventAction(
  userId: string,
  eventId: string,
  instruction: string,
): Promise<TemporalEventActionResult> {
  if (isTaskEventId(eventId)) {
    throw new Error(
      'Natural-language instructions are not supported for tasks. Use mark_done, reopen, or archive instead.',
    )
  }

  const row = await loadEventRow(userId, eventId)
  if (!row) {
    throw new Error('Event not found')
  }

  const [thoughtRow] = await getDb()
    .select()
    .from(thought)
    .where(and(eq(thought.id, row.thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!thoughtRow) {
    throw new Error('Source thought not found')
  }

  const thoughtText = thoughtRow.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: thoughtRow.normalizedTextEncrypted,
      })
    : thoughtRow.normalizedText
  const userTimezone = await getUserPreferredTimezone(userId)

  const applied = await applyTemporalEventActionRequest({
    userId,
    instruction,
    nowIso: new Date().toISOString(),
    userTimezone,
    event: {
      id: row.id,
      kind: row.kind,
      semanticSummary: row.semanticSummary,
      startAt: row.startAt?.toISOString() ?? null,
      endAt: row.endAt?.toISOString() ?? null,
      timezone: row.timezone,
      lifecycleStatus: row.lifecycleStatus,
      thoughtText,
    },
  })

  if (applied.thoughtTextPatch) {
    await editStoredThought(userId, row.thoughtId, applied.thoughtTextPatch)
    const item = await loadListItem(userId, eventId)
    if (item) {
      return { ok: true, item, summary: applied.summary }
    }
  }

  await applyLifecycleAndBoundsPatch(userId, eventId, applied)

  const item = await loadListItem(userId, eventId)
  if (!item) throw new Error('Event not found after update')

  return { ok: true, item, summary: applied.summary }
}

export async function applyStructuredRescheduleAction(
  userId: string,
  eventId: string,
  input: { startAt: string; endAt?: string | null },
): Promise<TemporalEventActionResult> {
  if (isTaskEventId(eventId)) {
    throw new Error('Rescheduling is not supported for tasks.')
  }

  const row = await loadEventRow(userId, eventId)
  if (!row) {
    throw new Error('Event not found')
  }

  const startAt = new Date(input.startAt)
  if (Number.isNaN(startAt.getTime())) {
    throw new Error('Invalid startAt')
  }
  const endAt = input.endAt ? new Date(input.endAt) : null
  if (endAt && Number.isNaN(endAt.getTime())) {
    throw new Error('Invalid endAt')
  }

  const summary = `Rescheduled "${row.semanticSummary}" to ${startAt.toISOString()}.`
  await applyLifecycleAndBoundsPatch(userId, eventId, {
    action: 'reschedule',
    lifecycleStatus: 'open',
    startAt: startAt.toISOString(),
    endAt: endAt?.toISOString() ?? null,
    snoozedUntil: null,
    summary,
  })

  const item = await loadListItem(userId, eventId)
  if (!item) throw new Error('Event not found after update')

  return { ok: true, item, summary }
}

export async function applyStructuredSnoozeAction(
  userId: string,
  eventId: string,
  snoozedUntil: string,
): Promise<TemporalEventActionResult> {
  if (isTaskEventId(eventId)) {
    throw new Error('Snoozing is not supported for tasks.')
  }

  const row = await loadEventRow(userId, eventId)
  if (!row) {
    throw new Error('Event not found')
  }

  const until = new Date(snoozedUntil)
  if (Number.isNaN(until.getTime())) {
    throw new Error('Invalid snoozedUntil')
  }

  const summary = `Snoozed "${row.semanticSummary}" until ${until.toISOString()}.`
  await applyLifecycleAndBoundsPatch(userId, eventId, {
    action: 'snooze',
    lifecycleStatus: 'open',
    snoozedUntil: until.toISOString(),
    summary,
  })

  const item = await loadListItem(userId, eventId)
  if (!item) throw new Error('Event not found after update')

  return { ok: true, item, summary }
}

/** @deprecated Use archiveTemporalEventForUser — kept for import stability. */
export async function deleteTemporalEventForUser(userId: string, eventId: string) {
  return archiveTemporalEventForUser(userId, eventId)
}

export { archiveTemporalEventForUser }
