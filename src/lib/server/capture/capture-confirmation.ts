/**
 * Capture confirmation gate: interpret → optional correct loop → confirm → enrich.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought, type CaptureSource, type EnrichQueueStatus } from '$lib/server/db/schema'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker'
import {
  interpretThoughtPreview,
  type CapturePreviewBundle,
} from '$lib/server/capture/interpret-thought'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'

export type { CapturePreviewBundle }

export type CaptureConfirmationResult = {
  thoughtId: string
  rawText: string
  preview: CapturePreviewBundle
  queueStatus: 'awaiting_confirmation'
}

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
 * Run interpret LLM first, then persist draft (awaiting_confirmation). Does not schedule enrich.
 * Ordering avoids orphan drafts when the provider rejects the interpret call.
 */
export async function interpretAndQueueCapture(
  userId: string,
  rawInput: string,
  options?: { source?: CaptureSource },
): Promise<CaptureConfirmationResult> {
  const preview = await interpretThoughtPreview({
    userId,
    rawText: rawInput,
  })

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

  return {
    thoughtId: queued.thoughtId,
    rawText: rawInput,
    preview,
    queueStatus: 'awaiting_confirmation',
  }
}

/**
 * Re-run interpret with correction; stay in awaiting_confirmation (no enrich).
 */
export async function correctCapturePreview(
  userId: string,
  thoughtId: string,
  correction: string,
): Promise<CaptureConfirmationResult> {
  const trimmed = correction.trim()
  if (!trimmed) {
    throw new Error('correction is required')
  }

  const draft = await loadAwaitingDraft(userId, thoughtId)
  const priorPreview = readPreview(draft.metadata)

  const preview = await interpretThoughtPreview({
    userId,
    rawText: draft.rawText,
    priorPreview,
    correction: trimmed,
  })

  const ontologyEntityKindId = await resolveCategoryKindId(userId, preview.category.key)
  await persistPreviewMetadata(
    userId,
    thoughtId,
    draft.metadata,
    preview,
    preview.category.key,
    ontologyEntityKindId,
  )

  return {
    thoughtId,
    rawText: draft.rawText,
    preview,
    queueStatus: 'awaiting_confirmation',
  }
}

/**
 * Promote interpreted text to normalized_text and schedule full enrich.
 * raw_text stays verbatim.
 */
export async function confirmCapturePreview(
  userId: string,
  thoughtId: string,
): Promise<ConfirmCaptureResult> {
  const draft = await loadAwaitingDraft(userId, thoughtId)
  const preview = readPreview(draft.metadata)
  const ontologyEntityKindId = await resolveCategoryKindId(userId, preview.category.key)

  const normalizedText = preview.interpretedText
  const lexicalText = computeLexicalText(normalizedText)
  const nextMetadata = {
    ...draft.metadata,
    preview,
    confirmationGate: true,
    confirmedAt: new Date().toISOString(),
    categoryConfidence: preview.category.confidence,
    categoryAlternatives: preview.category.alternatives,
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
      category: preview.category.key,
      ontologyEntityKindId,
      memoryType: preview.memoryType,
      metadata: { encrypted: true, confirmationGate: true },
      metadataEncrypted,
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))

  scheduleCaptureEnrichWorker(userId)

  return {
    thoughtId,
    rawText: draft.rawText,
    normalizedText,
    category: preview.category.key,
    memoryType: preview.memoryType,
    queueStatus: 'pending',
    preview,
  }
}
