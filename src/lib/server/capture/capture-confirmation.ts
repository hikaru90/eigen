/**
 * Capture confirmation gate: interpret → optional modal (deviation) → confirm/verbatim → enrich.
 */
import { and, eq, lt } from 'drizzle-orm'
import { notifyThoughtCreated } from '$lib/server/agents/notify'
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker'
import {
  interpretThoughtPreview,
  type CapturePreviewBundle,
} from '$lib/server/capture/interpret-thought'
import { queueCapture, QUEUE_PLACEHOLDER_CATEGORY } from '$lib/server/capture/queue-capture'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought, type CaptureSource, type EnrichQueueStatus } from '$lib/server/db/schema'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { assignThoughtToProject } from '$lib/server/memory/assign-thought-project'
import { findGtdProjectForUser } from '$lib/server/memory/project-membership'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'

export type { CapturePreviewBundle }

/** The thread the user picked on Capture: an existing project by id, or a new one by label. */
export type KeepThreadChoice = { projectEntityId: string } | { projectLabel: string }

/** A picked thread that is not (any longer) one of the user's GTD projects — a bad request, not a server fault. */
export class InvalidThreadChoiceError extends Error {
  constructor(projectEntityId: string) {
    super(`Picked thread "${projectEntityId}" is not one of your projects`)
    this.name = 'InvalidThreadChoiceError'
  }
}

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
  queueStatus: 'pending'
  preview: CapturePreviewBundle
}

async function loadConfirmationDraft(userId: string, thoughtId: string) {
  const [row] = await getDb()
    .select({
      id: thought.id,
      userId: thought.userId,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      category: thought.category,
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

/**
 * When confirm races with auto-accept / double-submit, the draft may already be
 * promoted. Return the persisted confirmed shape instead of throwing.
 */
function alreadyConfirmedResult(
  draft: Awaited<ReturnType<typeof loadConfirmationDraft>>,
): ConfirmCaptureResult | null {
  if (draft.enrichQueueStatus === 'awaiting_confirmation') return null
  if (draft.metadata.confirmationGate !== true) return null
  if (typeof draft.metadata.confirmedAt !== 'string') return null
  try {
    const preview = readPreview(draft.metadata)
    return {
      thoughtId: draft.id,
      rawText: draft.rawText,
      normalizedText: draft.normalizedText,
      category: draft.category,
      queueStatus: 'pending',
      preview,
    }
  } catch {
    return null
  }
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

/* ————— the up-front reading (ei redesign decision #3): read → keep ————— */

function requireConfidence(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a number between 0 and 1`)
  }
  return value
}

function requireNonEmptyString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new Error(`${field} must be a non-empty string`)
  return text
}

/**
 * A reading as the client accepted it: the CapturePreviewBundle minus the server-only
 * `ontologyEntityKindId`, which keep resolves from the key itself (never trusted from
 * the client).
 */
export type AcceptedReading = Omit<CapturePreviewBundle, 'category'> & {
  category: {
    key: string
    confidence: number
    alternatives: Array<{ key: string; confidence: number }>
  }
}

/**
 * Strict validation of a client-accepted reading against the CapturePreviewBundle
 * contract. Any violation throws — the accepted reading is written to normalized_text
 * and the category column, so nothing may be guessed or repaired here.
 */
export function parseAcceptedReading(input: unknown): AcceptedReading {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('reading must be an object')
  }
  const obj = input as Record<string, unknown>
  const interpretedText = requireNonEmptyString(obj.interpretedText, 'reading.interpretedText')

  const category = obj.category
  if (!category || typeof category !== 'object' || Array.isArray(category)) {
    throw new Error('reading.category must be an object')
  }
  const c = category as Record<string, unknown>
  const key = requireNonEmptyString(c.key, 'reading.category.key')
  const confidence = requireConfidence(c.confidence, 'reading.category.confidence')
  if (!Array.isArray(c.alternatives)) {
    throw new Error('reading.category.alternatives must be an array')
  }
  const alternatives = c.alternatives.map((alt, i) => {
    if (!alt || typeof alt !== 'object') {
      throw new Error(`reading.category.alternatives[${i}] must be an object`)
    }
    const a = alt as Record<string, unknown>
    return {
      key: requireNonEmptyString(a.key, `reading.category.alternatives[${i}].key`),
      confidence: requireConfidence(a.confidence, `reading.category.alternatives[${i}].confidence`),
    }
  })

  if (!Array.isArray(obj.entities)) {
    throw new Error('reading.entities must be an array')
  }
  const entities = obj.entities.map((ent, i) => {
    if (!ent || typeof ent !== 'object') {
      throw new Error(`reading.entities[${i}] must be an object`)
    }
    const e = ent as Record<string, unknown>
    return {
      surface: requireNonEmptyString(e.surface, `reading.entities[${i}].surface`),
      entityType: requireNonEmptyString(e.entityType, `reading.entities[${i}].entityType`),
      confidence: requireConfidence(e.confidence, `reading.entities[${i}].confidence`),
    }
  })

  if (typeof obj.deviatesFromVerbatim !== 'boolean') {
    throw new Error('reading.deviatesFromVerbatim must be a boolean')
  }

  return {
    interpretedText,
    category: { key, confidence, alternatives },
    entities,
    deviatesFromVerbatim: obj.deviatesFromVerbatim,
  }
}

/**
 * Keep a thought together with the reading the user already saw and accepted
 * (POST /api/capture/keep). The reading itself came from `interpretThoughtPreview`
 * via /api/capture/read, which persists nothing; this is the single place a row is
 * written for the up-front flow, composing the existing pieces exactly once:
 * queueCapture (draft) → persistPreviewMetadata → confirmCapturePreview (promote + enrich).
 *
 * Verbatim invariant: raw_text = `raw` exactly as typed; normalized_text = the accepted
 * `interpretedText`. The category is validated against the user's ontology *before* the
 * draft is queued so a bad reading leaves no row behind.
 */
export async function keepCaptureWithReading(
  userId: string,
  raw: string,
  acceptedInput: unknown,
  options?: { source?: CaptureSource; capturedAt?: Date; thread?: KeepThreadChoice },
): Promise<ConfirmCaptureResult> {
  if (!raw.trim()) throw new Error('raw is required')
  const accepted = parseAcceptedReading(acceptedInput)
  const ontologyEntityKindId = await resolveCategoryKindId(userId, accepted.category.key)
  const reading: CapturePreviewBundle = {
    ...accepted,
    category: { ...accepted.category, ontologyEntityKindId },
  }

  // A stale picked thread must fail the keep before any row exists (same boundary as
  // the category check above) — never silently keep the thought without its thread.
  if (options?.thread && 'projectEntityId' in options.thread) {
    const project = await findGtdProjectForUser(userId, options.thread.projectEntityId)
    if (!project) throw new InvalidThreadChoiceError(options.thread.projectEntityId)
  }

  const queued = await queueCapture(userId, raw, {
    source: options?.source ?? 'ui',
    awaitConfirmation: true,
    skipWorker: true,
    ...(options?.capturedAt ? { capturedAt: options.capturedAt } : {}),
  })

  // The user's picked thread is membership, not a mention: written before confirm
  // schedules enrich, so the mesh lists the thread immediately and the enrich GTD
  // assignment sees the manual link and never re-decides.
  if (options?.thread) {
    await assignThoughtToProject(userId, queued.thoughtId, options.thread)
  }

  const draft = await loadConfirmationDraft(userId, queued.thoughtId)
  if (draft.enrichQueueStatus !== 'awaiting_confirmation') {
    throw new Error('Thought is not awaiting confirmation')
  }
  await persistPreviewMetadata(
    userId,
    queued.thoughtId,
    draft.metadata,
    reading,
    reading.category.key,
    ontologyEntityKindId,
  )
  return confirmCapturePreview(userId, queued.thoughtId, { verbatim: false })
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
  const forceConfirmation = options?.forceConfirmation === true && allowCaptureForceConfirmation()
  const preview: CapturePreviewBundle = forceConfirmation
    ? { ...llmPreview, deviatesFromVerbatim: true }
    : llmPreview

  const queued = await queueCapture(userId, rawInput, {
    source: options?.source ?? 'ui',
    awaitConfirmation: true,
    skipWorker: true,
  })

  const ontologyEntityKindId = await resolveCategoryKindId(userId, preview.category.key)
  const draft = await loadConfirmationDraft(userId, queued.thoughtId)
  if (draft.enrichQueueStatus !== 'awaiting_confirmation') {
    throw new Error('Thought is not awaiting confirmation')
  }
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
 * Idempotent when the draft was already confirmed (client/server auto-accept race).
 */
export async function confirmCapturePreview(
  userId: string,
  thoughtId: string,
  options?: { verbatim?: boolean },
): Promise<ConfirmCaptureResult> {
  const verbatim = options?.verbatim === true
  const draft = await loadConfirmationDraft(userId, thoughtId)

  if (draft.enrichQueueStatus !== 'awaiting_confirmation') {
    const already = alreadyConfirmedResult(draft)
    if (already) return already
    throw new Error('Thought is not awaiting confirmation')
  }

  const preview = readPreview(draft.metadata)

  const normalizedText = verbatim ? draft.rawText : preview.interpretedText
  const lexicalText = computeLexicalText(normalizedText)
  const categoryKey = verbatim ? QUEUE_PLACEHOLDER_CATEGORY : preview.category.key
  const ontologyEntityKindId = await resolveCategoryKindId(userId, categoryKey)

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

  const promoted = await getDb()
    .update(thought)
    .set({
      normalizedText,
      normalizedTextEncrypted,
      lexicalText,
      category: categoryKey,
      ontologyEntityKindId,
      metadata: { encrypted: true, confirmationGate: true },
      metadataEncrypted,
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(thought.id, thoughtId),
        eq(thought.userId, userId),
        eq(thought.enrichQueueStatus, 'awaiting_confirmation'),
      ),
    )
    .returning({ id: thought.id })

  if (promoted.length === 0) {
    const again = await loadConfirmationDraft(userId, thoughtId)
    const already = alreadyConfirmedResult(again)
    if (already) return already
    throw new Error('Thought is not awaiting confirmation')
  }

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
    queueStatus: 'pending',
    preview,
  }
}

/**
 * Auto-confirm awaiting_confirmation drafts older than CONFIRMATION_AUTO_ACCEPT_MS
 * using the stored LLM interpretation (same outcome as the 5s countdown timeout).
 */
export async function autoConfirmStaleAwaitingConfirmationDrafts(userId: string): Promise<number> {
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
