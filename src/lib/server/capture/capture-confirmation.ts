/**
 * Capture confirmation gate: interpret → optional modal (deviation) → confirm/verbatim → enrich.
 */
import { and, eq, lt } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought, type CaptureSource, type EnrichQueueStatus } from '$lib/server/db/schema'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { queueCapture, QUEUE_PLACEHOLDER_CATEGORY } from '$lib/server/capture/queue-capture'
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker'
import {
  interpretThoughtPreview,
  type CapturePreviewBundle,
} from '$lib/server/capture/interpret-thought'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { notifyThoughtCreated } from '$lib/server/agents/notify'

export type { CapturePreviewBundle }

/** Client countdown + stranded-draft auto-accept window. */
export const CONFIRMATION_AUTO_ACCEPT_MS = 5_000

/**
 * E2E/dev-only: force the confirmation modal path regardless of the LLM judge.
 * Never allowed in production.
 */
export function allowCaptureForceConfirmation(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export type CaptureInterpretResult =
  | {
      status: 'awaiting_confirmation'
      thoughtId: string
      rawText: string
      preview: CapturePreviewBundle
      queueStatus: 'awaiting_confirmation'
    }
  | {
      status: 'ingested'
      thoughtId: string
      rawText: string
      preview: CapturePreviewBundle
      queueStatus: 'pending'
      normalizedText: string
      category: string
      memoryType: string | null
    }

/** @deprecated Prefer CaptureInterpretResult — kept for older callers expecting queueStatus. */
export type CaptureConfirmationResult = Extract<
  CaptureInterpretResult,
  { status: 'awaiting_confirmation' }
>

export type ConfirmCaptureResult = {
  thoughtId: string
  rawText: string
  normalizedText: string
  category: string
  memoryType: string | null
  queueStatus: 'pending'
  preview: CapturePreviewBundle
}

async function loadAwaitingDraft(userId: string, thoughtId: string) {
  const [row] = await getDb()
    .select({
      id: thought.id,
      userId: thought.userId,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      enrichQueueStatus: thought.enrichQueueStatus,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      ontologyEntityKindId: thought.ontologyEntityKindId,
      captureSource: thought.captureSource,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!row) {
    throw new Error('Thought not found')
  }
  if (row.enrichQueueStatus !== 'awaiting_confirmation') {
    throw new Error('Thought is not awaiting confirmation')
  }

  const [rawText, metadataJson] = await Promise.all([
    row.rawTextEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'raw_text',
          ciphertext: row.rawTextEncrypted,
        })
      : Promise.resolve(row.rawText),
    row.metadataEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : Promise.resolve(JSON.stringify(row.metadata ?? {})),
  ])

  const metadata = JSON.parse(metadataJson) as Record<string, unknown>
  return { ...row, rawText, metadata }
}

function readPreview(metadata: Record<string, unknown>): CapturePreviewBundle {
  const preview = metadata.preview
  if (!preview || typeof preview !== 'object') {
    throw new Error('Draft is missing confirmation preview metadata')
  }
  return preview as CapturePreviewBundle
}

async function persistPreviewMetadata(
  userId: string,
  thoughtId: string,
  metadata: Record<string, unknown>,
  preview: CapturePreviewBundle,
  categoryKey: string,
  ontologyEntityKindId: string,
) {
  const nextMetadata = {
    ...metadata,
    preview,
    confirmationGate: true,
  }
  const metadataEncrypted = await encryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    plaintext: JSON.stringify(nextMetadata),
  })

  await getDb()
    .update(thought)
    .set({
      category: categoryKey,
      ontologyEntityKindId,
      metadata: { encrypted: true, confirmationGate: true },
      metadataEncrypted,
      enrichQueueStatus: 'awaiting_confirmation' satisfies EnrichQueueStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
}

async function resolveCategoryKindId(userId: string, categoryKey: string): Promise<string> {
  await ensureUserOntologySeeded(getDb(), userId)
  const loaded = await loadOntologyForUser(getDb(), userId)
  const kind = loaded.entityKindsByKey.get(categoryKey)
  if (!kind) {
    throw new Error(`Unknown category key "${categoryKey}" in user ontology`)
  }
  return kind.id
}

/**
 * Run interpret LLM first, then either auto-ingest (no deviation) or persist a draft
 * awaiting confirmation (deviation). Does not schedule enrich for drafts.
 *
 * `forceConfirmation` (non-production only) overrides the LLM judge so e2e can
 * deterministically exercise Confirm / Dismiss / auto-accept.
 */
export async function interpretAndQueueCapture(
  userId: string,
  rawInput: string,
  options?: { source?: CaptureSource; forceConfirmation?: boolean },
): Promise<CaptureInterpretResult> {
  const llmPreview = await interpretThoughtPreview({
    userId,
    rawText: rawInput,
  })
  const forceConfirmation =
    options?.forceConfirmation === true && allowCaptureForceConfirmation()
  const preview: CapturePreviewBundle = forceConfirmation
    ? { ...llmPreview, deviatesFromVerbatim: true }
    : llmPreview

  const queued = await queueCapture(userId, rawInput, {
    source: options?.source ?? 'ui',
    awaitConfirmation: true,
    skipWorker: true,
  })

  const ontologyEntityKindId = await resolveCategoryKindId(userId, preview.category.key)
  const draft = await loadAwaitingDraft(userId, queued.thoughtId)
  await persistPreviewMetadata(
    userId,
    queued.thoughtId,
    draft.metadata,
    preview,
    preview.category.key,
    ontologyEntityKindId,
  )

  if (!preview.deviatesFromVerbatim) {
    const confirmed = await confirmCapturePreview(userId, queued.thoughtId, { verbatim: false })
    return {
      status: 'ingested',
      thoughtId: confirmed.thoughtId,
      rawText: confirmed.rawText,
      preview: confirmed.preview,
      queueStatus: 'pending',
      normalizedText: confirmed.normalizedText,
      category: confirmed.category,
      memoryType: confirmed.memoryType,
    }
  }

  return {
    status: 'awaiting_confirmation',
    thoughtId: queued.thoughtId,
    rawText: rawInput,
    preview,
    queueStatus: 'awaiting_confirmation',
  }
}

/**
 * Promote draft to pending enrich.
 * verbatim:true → store raw text unchanged; otherwise accept LLM interpretation.
 */
export async function confirmCapturePreview(
  userId: string,
  thoughtId: string,
  options?: { verbatim?: boolean },
): Promise<ConfirmCaptureResult> {
  const verbatim = options?.verbatim === true
  const draft = await loadAwaitingDraft(userId, thoughtId)
  const preview = readPreview(draft.metadata)

  const normalizedText = verbatim ? draft.rawText : preview.interpretedText
  const lexicalText = computeLexicalText(normalizedText)
  const categoryKey = verbatim ? QUEUE_PLACEHOLDER_CATEGORY : preview.category.key
  const ontologyEntityKindId = await resolveCategoryKindId(userId, categoryKey)
  const memoryType = verbatim ? null : preview.memoryType

  const nextMetadata = {
    ...draft.metadata,
    preview,
    confirmationGate: true,
    confirmedAt: new Date().toISOString(),
    confirmedVerbatim: verbatim,
    ...(verbatim
      ? {}
      : {
          categoryConfidence: preview.category.confidence,
          categoryAlternatives: preview.category.alternatives,
        }),
  }

  const [normalizedTextEncrypted, metadataEncrypted] = await Promise.all([
    encryptTenantValue({
      userId,
      table: 'thought',
      column: 'normalized_text',
      plaintext: normalizedText,
    }),
    encryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      plaintext: JSON.stringify(nextMetadata),
    }),
  ])

  await getDb()
    .update(thought)
    .set({
      normalizedText,
      normalizedTextEncrypted,
      lexicalText,
      category: categoryKey,
      ontologyEntityKindId,
      memoryType,
      metadata: { encrypted: true, confirmationGate: true },
      metadataEncrypted,
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))

  scheduleCaptureEnrichWorker(userId)

  notifyThoughtCreated({
    userId,
    thoughtId,
    normalizedText,
    source: draft.captureSource ?? 'ui',
    projectEntityIds: [],
    projectLabels: [],
  })

  return {
    thoughtId,
    rawText: draft.rawText,
    normalizedText,
    category: categoryKey,
    memoryType,
    queueStatus: 'pending',
    preview,
  }
}

/**
 * Auto-confirm awaiting_confirmation drafts older than CONFIRMATION_AUTO_ACCEPT_MS
 * using the stored LLM interpretation (same outcome as the 5s countdown timeout).
 */
export async function autoConfirmStaleAwaitingConfirmationDrafts(
  userId: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - CONFIRMATION_AUTO_ACCEPT_MS)
  const stale = await getDb()
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        eq(thought.enrichQueueStatus, 'awaiting_confirmation'),
        lt(thought.createdAt, cutoff),
      ),
    )
    .limit(50)

  let confirmed = 0
  for (const row of stale) {
    try {
      await confirmCapturePreview(userId, row.id, { verbatim: false })
      confirmed += 1
    } catch (err) {
      console.error('[capture-confirmation] failed to auto-confirm stale draft', {
        userId,
        thoughtId: row.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return confirmed
}
