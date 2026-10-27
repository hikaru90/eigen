import { eq, and } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  graphSyncJob,
  temporalEvent,
  thought,
  type GraphSyncJobOperation,
  type TemporalEventKind,
} from '$lib/server/db/schema'
import { processPendingGraphSyncJobs } from '$lib/server/graph/graph-sync-worker'
import { resolveDecisionEnforceKinds } from '$lib/server/llm/decision-client'
import { runEnforcedPerItemDecisions } from '$lib/server/llm/decision-plane'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { authorshipInsertValues } from '$lib/server/memory/authorship'
import { syncReminderScheduleForEvent } from '$lib/server/memory/event-reminder-schedule'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { refreshFocusRanksForUser } from '$lib/server/memory/temporal-event-list'
import { extractTemporalMentions } from '$lib/server/memory/temporal-extraction'
import {
  applyCaptureAnchoredMentions,
  resolveTemporalBounds,
  type ExtractedTemporalMention,
} from '$lib/server/memory/temporal-normalize'

const DEFAULT_TIMEZONE = 'UTC'

const TEMPORAL_KINDS: readonly TemporalEventKind[] = [
  'deadline',
  'appointment',
  'milestone',
  'period',
  'reminder',
  'inferred_event',
]

/**
 * Narrows a decision answer to the persisted kind union. Formality only: the
 * decision plane already throws on off-catalog choices, and the criteria keys
 * below are exactly this union.
 */
function isTemporalKind(value: string): value is TemporalEventKind {
  return (TEMPORAL_KINDS as readonly string[]).includes(value)
}

/** LLM often returns UTC; persist the user's anchor timezone for display and day boundaries. */
function resolvePersistedTimezone(mentionTimezone: string, userTimezone: string): string {
  const mention = mentionTimezone?.trim()
  if (!mention || mention === 'UTC' || mention === 'Etc/UTC') return userTimezone
  return mention
}

/**
 * Extract temporal facts from a thought, persist to Postgres, enqueue AGE graph sync jobs.
 * Postgres is the ledger; graph sync runs post-commit via the outbox worker.
 */
export async function syncTemporalEventsFromThought(input: {
  userId: string
  thoughtId: string
  normalizedText: string
  thoughtEmbedding?: number[]
  capturedAt?: Date
  timezone?: string
  /** Pre-fetched LLM extraction (batch ingest). Skips extractTemporalMentions when set. */
  precomputedMentions?: ExtractedTemporalMention[]
  /** The owner's correction of the last reading (prompt context only, never stored or logged). */
  ownerCorrection?: string
}): Promise<void> {
  const db = getDb()
  const capturedAt = input.capturedAt ?? new Date()
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE

  const [thoughtAuthorshipRow] = await db
    .select({
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
    })
    .from(thought)
    .where(and(eq(thought.userId, input.userId), eq(thought.id, input.thoughtId)))
    .limit(1)
  const authorValues = authorshipInsertValues({
    author: thoughtAuthorshipRow?.author ?? 'user',
    authorLabel: thoughtAuthorshipRow?.authorLabel ?? null,
    authorKeyId: thoughtAuthorshipRow?.authorKeyId ?? null,
  })

  let mentions = applyCaptureAnchoredMentions(
    input.precomputedMentions ??
      (await extractTemporalMentions({
        userId: input.userId,
        normalizedText: input.normalizedText,
        capturedAt,
        timezone,
        ownerCorrection: input.ownerCorrection,
      })),
    capturedAt,
  )

  // Enforced temporal-kind typing (DECISION_ENFORCE_KINDS=temporal_kind): one
  // per-mention decision-model question; the answer overrides ONLY `kind` —
  // dates, timezone, and precision stay extraction/code-owned. No try/catch:
  // an enforced failure propagates (callers own the retry semantics).
  if (resolveDecisionEnforceKinds().has('temporal_kind') && mentions.length > 0) {
    const answers = await runEnforcedPerItemDecisions({
      userId: input.userId,
      surface: 'enrich_queued',
      kind: 'temporal_kind',
      state: input.normalizedText,
      criteria: {
        deadline: 'A date by which something must be completed.',
        appointment: 'A scheduled meeting or occurrence at a specific time.',
        milestone: 'A significant checkpoint marking progress, without a hard deadline.',
        period: 'A span of days, weeks, or months rather than a single point in time.',
        reminder: 'A note to check or do something at a time, without a hard commitment.',
        inferred_event: 'A date or time the text implies rather than states explicitly.',
      },
      items: mentions.map((mention, index) => ({
        ref: `t${index + 1}`,
        instructions: `Which temporal kind best matches the temporal mention "${mention.surface}" in this captured thought?`,
        llmChoice: mention.kind,
        llmConfidence: mention.confidence,
      })),
    })
    mentions = mentions.map((mention, index) => {
      const answer = answers.get(`t${index + 1}`)
      return answer && isTemporalKind(answer.choice) ? { ...mention, kind: answer.choice } : mention
    })
  }

  // Replace prior temporal rows: enqueue AGE graph deletes, then remove Postgres ledger rows.
  const existing = await db
    .select({ id: temporalEvent.id, graphNodeId: temporalEvent.graphNodeId })
    .from(temporalEvent)
    .where(eq(temporalEvent.thoughtId, input.thoughtId))

  if (existing.length > 0) {
    await db.transaction(async (tx) => {
      for (const row of existing) {
        if (row.graphNodeId) {
          await tx.insert(graphSyncJob).values({
            userId: input.userId,
            temporalEventId: row.id,
            operation: 'delete_temporal_event',
            payload: { temporalEventId: row.id },
          })
        }
      }
      await tx.delete(temporalEvent).where(eq(temporalEvent.thoughtId, input.thoughtId))
    })
    void processPendingGraphSyncJobs({ userId: input.userId }).catch((err) => {
      console.error('[temporal-graph-sync] delete graph sync failed', {
        thoughtId: input.thoughtId,
        message: err instanceof Error ? err.message : String(err),
      })
    })
  }

  if (mentions.length === 0) return

  const embedding =
    input.thoughtEmbedding ?? (await createThoughtEmbedding(input.userId, input.normalizedText))

  const insertedJobIds: string[] = []
  const insertedBySurface = new Map<string, string>()

  await db.transaction(async (tx) => {
    for (const mention of mentions) {
      const bounds = resolveTemporalBounds(mention)
      const lexicalText = computeLexicalText(
        `${mention.semanticSummary} ${mention.surface} ${mention.kind}`,
      )

      const [row] = await tx
        .insert(temporalEvent)
        .values({
          userId: input.userId,
          thoughtId: input.thoughtId,
          kind: mention.kind,
          activePeriod: bounds.activePeriodLiteral,
          timePrecision: mention.timePrecision,
          timezone: resolvePersistedTimezone(mention.timezone, timezone),
          isAllDay: mention.isAllDay,
          recurrenceRule: mention.recurrenceRule ?? null,
          durationMinutes: mention.durationMinutes ?? null,
          energyLevel: mention.energyLevel ?? null,
          priorityQuadrant: mention.priorityQuadrant ?? null,
          contextTags: mention.contextTags ?? null,
          confidence: mention.confidence,
          semanticSummary: mention.semanticSummary,
          embedding,
          lexicalText,
          sourceTextSpan: mention.surface,
          parseMetadata: {
            startAt: mention.startAt,
            endAt: mention.endAt ?? null,
            capturedAt: capturedAt.toISOString(),
            ...(mention.contextTags ? { contextTags: mention.contextTags } : {}),
          },
          startAt: bounds.start,
          endAt: bounds.end,
          graphSyncStatus: 'pending',
          ...authorValues,
        })
        .returning({ id: temporalEvent.id })

      insertedBySurface.set(mention.surface, row.id)

      const payload = {
        temporalEventId: row.id,
        thoughtId: input.thoughtId,
        kind: mention.kind,
        semanticSummary: mention.semanticSummary,
        startAt: bounds.start.toISOString(),
        endAt: bounds.end.toISOString(),
      }

      const [job] = await tx
        .insert(graphSyncJob)
        .values({
          userId: input.userId,
          temporalEventId: row.id,
          operation: 'upsert_temporal_event' satisfies GraphSyncJobOperation,
          payload,
        })
        .returning({ id: graphSyncJob.id })

      insertedJobIds.push(job.id)

      void syncReminderScheduleForEvent({
        userId: input.userId,
        temporalEventId: row.id,
        kind: mention.kind,
        startAt: bounds.start,
        lifecycleStatus: 'open',
      }).catch((err) => {
        console.error('[temporal-graph-sync] reminder schedule failed', {
          temporalEventId: row.id,
          message: err instanceof Error ? err.message : String(err),
        })
      })
    }

    for (const mention of mentions) {
      if (!mention.parentSurface) continue
      const childId = insertedBySurface.get(mention.surface)
      const parentId = insertedBySurface.get(mention.parentSurface)
      if (!childId || !parentId) continue
      await tx
        .update(temporalEvent)
        .set({ parentEventId: parentId })
        .where(eq(temporalEvent.id, childId))
    }
  })

  void refreshFocusRanksForUser(input.userId, timezone).catch((err) => {
    console.error('[temporal-graph-sync] focus rank refresh failed', {
      thoughtId: input.thoughtId,
      message: err instanceof Error ? err.message : String(err),
    })
  })

  // Immediate post-commit sync attempt (non-blocking for enrich overall).
  void processPendingGraphSyncJobs({
    userId: input.userId,
    jobIds: insertedJobIds,
  }).catch((err) => {
    console.error('[temporal-graph-sync] post-commit graph sync failed', {
      thoughtId: input.thoughtId,
      message: err instanceof Error ? err.message : String(err),
    })
  })
}
