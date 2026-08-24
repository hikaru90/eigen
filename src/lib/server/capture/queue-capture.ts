/**
 * Tier 1 hot path: persist full text + lexical_text only, return immediately. Row is the queue.
 * Tier 2 (background enrich) and tier 3 (overnight consolidation) add vectors, links, and
 * community artifacts on the same row — see docs/planning/ingest-retrieval-timing.md.
 */
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { assertCapturePipelineAffordable } from '$lib/server/billing/usage-gate'
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker'
import { normalizeThoughtText } from '$lib/server/capture/service'
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import {
  captureSession,
  thought,
  type CaptureSource,
  type EnrichQueueStatus,
  type MemoryAuthor,
} from '$lib/server/db/schema'
import { upsertThoughtNode } from '$lib/server/graph/age'
import {
  resolveMemoryAuthorship,
  authorshipInsertValues,
  graphAuthorProperty,
} from '$lib/server/memory/authorship'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'

/** Placeholder category until background worker classifies. */
export const QUEUE_PLACEHOLDER_CATEGORY = 'observation'

/**
 * Max wait for the best-effort AGE thought-node upsert on the tier-1 path.
 * A hung AGE/DB lock must not strand `queueCapture` / interpret HTTP (confirm card never mounts).
 * Tier-2 enrich re-ensures the graph anchor.
 */
export const TIER1_GRAPH_ANCHOR_TIMEOUT_MS = 5_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(handle)
        resolve(value)
      },
      (err) => {
        clearTimeout(handle)
        reject(err)
      },
    )
  })
}

export type QueueCaptureResult = {
  thoughtId: string
  status: 'queued'
  normalizedText: string
}

export type QueueCaptureOptions = {
  source?: CaptureSource
  author?: MemoryAuthor
  authorLabel?: string | null
  authorKeyId?: string | null
  /** When true, skip scheduling background worker (eval inline enrich). */
  skipWorker?: boolean
  /**
   * When true, persist draft for UI confirmation gate: enrich_queue_status=awaiting_confirmation
   * and do not schedule the enrich worker until confirm.
   */
  awaitConfirmation?: boolean
  /** Override thought.createdAt (e.g. backdated haystack session date from external driver). */
  capturedAt?: Date
}

async function resolvePlaceholderOntologyKindId(userId: string): Promise<string> {
  await ensureUserOntologySeeded(getDb(), userId)
  const loaded = await loadOntologyForUser(getDb(), userId)
  const kind = loaded.entityKindsByKey.get(QUEUE_PLACEHOLDER_CATEGORY)
  if (!kind) {
    throw new Error(
      `Queue capture requires placeholder category "${QUEUE_PLACEHOLDER_CATEGORY}" in user ontology`,
    )
  }
  return kind.id
}

/**
 * Insert one thought row (full text, no LLM). Returns immediately.
 */
export async function queueCapture(
  userId: string,
  rawInput: string,
  options?: QueueCaptureOptions,
): Promise<QueueCaptureResult> {
  await assertCapturePipelineAffordable(userId)
  const { normalized, metadata } = normalizeThoughtText(rawInput)
  const lexicalText = computeLexicalText(normalized)
  const ontologyEntityKindId = await resolvePlaceholderOntologyKindId(userId)
  const source = options?.source ?? 'api'
  const authorship = resolveMemoryAuthorship({
    author: options?.author,
    authorLabel: options?.authorLabel,
    authorKeyId: options?.authorKeyId,
  })
  const authorValues = authorshipInsertValues(authorship)

  const [rawInputEncrypted, normalizedPreviewEncrypted, rawTextEncrypted, normalizedTextEncrypted] =
    await Promise.all([
      encryptTenantValue({
        userId,
        table: 'capture_session',
        column: 'raw_input',
        plaintext: rawInput,
      }),
      encryptTenantValue({
        userId,
        table: 'capture_session',
        column: 'normalized_preview',
        plaintext: normalized,
      }),
      encryptTenantValue({ userId, table: 'thought', column: 'raw_text', plaintext: rawInput }),
      encryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        plaintext: normalized,
      }),
    ])

  const awaitConfirmation = options?.awaitConfirmation === true
  const queueTier = awaitConfirmation ? 'awaiting_confirmation' : 'pending_enrich'
  const enrichQueueStatus: EnrichQueueStatus = awaitConfirmation
    ? 'awaiting_confirmation'
    : 'pending'

  const metadataEncrypted = await encryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    plaintext: JSON.stringify({
      ...metadata,
      queueTier,
      ...(awaitConfirmation ? { confirmationGate: true } : {}),
    }),
  })

  const db = getDb()
  const capturedAt = options?.capturedAt
  // Tier-1 durability: session + thought commit atomically — no orphaned session rows.
  const { stored } = await db.transaction(async (tx) => {
    const [sessionRow] = await tx
      .insert(captureSession)
      .values({
        userId,
        status: 'accepted',
        rawInput,
        rawInputEncrypted,
        normalizedPreview: normalized,
        normalizedPreviewEncrypted,
        category: QUEUE_PLACEHOLDER_CATEGORY,
        metadataPreview: { encrypted: true },
        revisionCount: 0,
        ...authorValues,
      })
      .returning({ id: captureSession.id })

    const [stored] = await tx
      .insert(thought)
      .values({
        userId,
        rawText: rawInput,
        rawTextEncrypted,
        normalizedText: normalized,
        normalizedTextEncrypted,
        lexicalText,
        category: QUEUE_PLACEHOLDER_CATEGORY,
        ontologyEntityKindId,
        metadata: {
          encrypted: true,
          captureSessionId: sessionRow.id,
          queueTier,
          ...(awaitConfirmation ? { confirmationGate: true } : {}),
        },
        metadataEncrypted,
        enrichQueueStatus,
        captureSource: source,
        ...authorValues,
        ...(capturedAt ? { createdAt: capturedAt, updatedAt: capturedAt } : {}),
      })
      .returning({ id: thought.id })

    return { stored }
  })

  // Best-effort provenance anchor: tier-2 enrich re-ensures it (entity-graph-sync), so a
  // transient AGE outage or hang must not fail the capture or strand the queued row — the
  // committed Postgres row is the tier-1 contract. The failure is loud, not swallowed.
  // try/catch alone only covers rejects; wrap with a hard timeout so lock-waits reject too.
  try {
    await withTimeout(
      upsertThoughtNode({
        id: stored.id,
        userId,
        category: QUEUE_PLACEHOLDER_CATEGORY,
        author: graphAuthorProperty(authorship),
      }),
      TIER1_GRAPH_ANCHOR_TIMEOUT_MS,
      'tier-1 graph anchor upsert',
    )
  } catch (err) {
    console.error(
      '[queue-capture] tier-1 graph anchor upsert failed; tier-2 enrich will re-ensure it',
      {
        userId,
        thoughtId: stored.id,
        message: err instanceof Error ? err.message : String(err),
      },
    )
  }

  if (!options?.skipWorker && !awaitConfirmation) {
    scheduleCaptureEnrichWorker(userId)
  }

  // Drafts awaiting UI confirmation must not broadcast as real thoughts until confirm/verbatim.
  if (!awaitConfirmation) {
    const { notifyThoughtCreated } = await import('$lib/server/agents/notify')
    notifyThoughtCreated({
      userId,
      thoughtId: stored.id,
      normalizedText: normalized,
      source,
      createdAt: capturedAt ?? undefined,
      projectEntityIds: [],
      projectLabels: [],
    })
  }

  return {
    thoughtId: stored.id,
    status: 'queued',
    normalizedText: normalized,
  }
}

export type ClaimedQueuedThought = {
  id: string
  rawText: string
  normalizedText: string
  rawTextEncrypted: string | null
  normalizedTextEncrypted: string | null
}

/**
 * Atomically claim the next pending row for this user (FIFO).
 */
export async function claimNextPendingThought(
  userId: string,
): Promise<ClaimedQueuedThought | null> {
  const db = getDb()
  const [next] = await db
    .select({
      id: thought.id,
      rawText: thought.rawText,
      normalizedText: thought.normalizedText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.userId, userId), eq(thought.enrichQueueStatus, 'pending')))
    .orderBy(asc(thought.createdAt), asc(thought.id))
    .limit(1)

  if (!next) return null

  const [claimed] = await db
    .update(thought)
    .set({ enrichQueueStatus: 'processing' satisfies EnrichQueueStatus })
    .where(and(eq(thought.id, next.id), eq(thought.enrichQueueStatus, 'pending')))
    .returning({
      id: thought.id,
      rawText: thought.rawText,
      normalizedText: thought.normalizedText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })

  return claimed ?? null
}

export async function markEnrichQueueComplete(thoughtId: string): Promise<void> {
  await getDb()
    .update(thought)
    .set({
      enrichQueueStatus: 'complete' satisfies EnrichQueueStatus,
      enrichQueueError: null,
    })
    .where(eq(thought.id, thoughtId))
}

export async function markEnrichQueueFailed(thoughtId: string, error: string): Promise<void> {
  await getDb()
    .update(thought)
    .set({
      enrichQueueStatus: 'failed' satisfies EnrichQueueStatus,
      enrichQueueError: error.slice(0, 2000),
    })
    .where(eq(thought.id, thoughtId))
}

export async function countPendingEnrichRows(userId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(thought)
    .where(and(eq(thought.userId, userId), eq(thought.enrichQueueStatus, 'pending')))
  return Number(row?.n ?? 0)
}

/** Default age before a stuck `processing` row is requeued as `pending`. */
export const STALE_ENRICH_PROCESSING_MAX_AGE_MS = 10 * 60 * 1000

const STALE_RECOVERY_NOTE = 'Enrichment interrupted before completion (stale processing recovery)'
const INFLIGHT_RECOVERY_NOTE =
  'Enrichment interrupted before completion (in-flight processing recovery)'

/**
 * Reset enrich rows left in `processing` after a worker crash or hang.
 * Returns the number of rows requeued.
 */
export async function recoverStaleEnrichProcessingRows(
  userId: string,
  maxAgeMs: number = STALE_ENRICH_PROCESSING_MAX_AGE_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const db = getDb()
  const stale = await db
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        eq(thought.enrichQueueStatus, 'processing'),
        lt(thought.updatedAt, cutoff),
      ),
    )

  if (stale.length === 0) return 0

  await db
    .update(thought)
    .set({
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: STALE_RECOVERY_NOTE,
    })
    .where(
      and(
        eq(thought.userId, userId),
        inArray(
          thought.id,
          stale.map((row) => row.id),
        ),
      ),
    )

  return stale.length
}

/**
 * Requeue all in-flight `processing` rows when no worker is draining this tenant
 * (e.g. dev-server restart killed the background task before completion).
 */
export async function requeueInFlightProcessingRows(userId: string): Promise<number> {
  const db = getDb()
  const inFlight = await db
    .select({ id: thought.id })
    .from(thought)
    .where(and(eq(thought.userId, userId), eq(thought.enrichQueueStatus, 'processing')))

  if (inFlight.length === 0) return 0

  await db
    .update(thought)
    .set({
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: INFLIGHT_RECOVERY_NOTE,
    })
    .where(
      and(
        eq(thought.userId, userId),
        inArray(
          thought.id,
          inFlight.map((row) => row.id),
        ),
      ),
    )

  return inFlight.length
}

/**
 * Mark queue rows complete when enriched_at is already set (worker interrupted after enrich).
 */
export async function completeEnrichedQueueRows(userId: string): Promise<number> {
  const db = getDb()
  const enriched = await db
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        inArray(thought.enrichQueueStatus, ['pending', 'processing']),
        isNotNull(thought.enrichedAt),
      ),
    )

  if (enriched.length === 0) return 0

  await db
    .update(thought)
    .set({
      enrichQueueStatus: 'complete' satisfies EnrichQueueStatus,
      enrichQueueError: null,
    })
    .where(
      and(
        eq(thought.userId, userId),
        inArray(
          thought.id,
          enriched.map((row) => row.id),
        ),
      ),
    )

  return enriched.length
}

/**
 * Re-queue rows marked complete without enriched_at (orphaned tier-2 state).
 * Returns the number of rows requeued.
 */
export async function requeueOrphanedCompleteEnrichRows(userId: string): Promise<number> {
  const db = getDb()
  const orphaned = await db
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        eq(thought.enrichQueueStatus, 'complete' satisfies EnrichQueueStatus),
        isNull(thought.enrichedAt),
      ),
    )

  if (orphaned.length === 0) return 0

  await db
    .update(thought)
    .set({
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: null,
    })
    .where(
      and(
        eq(thought.userId, userId),
        inArray(
          thought.id,
          orphaned.map((row) => row.id),
        ),
      ),
    )

  return orphaned.length
}

const RETRYABLE_ENRICH_STATUSES: EnrichQueueStatus[] = ['pending', 'processing', 'failed']

/** Re-queue one thought for background enrich (user-initiated retry). */
export async function requeueEnrichThought(
  userId: string,
  thoughtId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'not_retryable' }> {
  const db = getDb()
  const [existing] = await db
    .select({
      id: thought.id,
      enrichQueueStatus: thought.enrichQueueStatus,
      enrichedAt: thought.enrichedAt,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!existing) {
    return { ok: false, reason: 'not_found' }
  }

  const status = existing.enrichQueueStatus
  const orphanedComplete = status === 'complete' && existing.enrichedAt == null
  if (!orphanedComplete && (!status || !RETRYABLE_ENRICH_STATUSES.includes(status))) {
    return { ok: false, reason: 'not_retryable' }
  }

  await db
    .update(thought)
    .set({
      enrichQueueStatus: 'pending' satisfies EnrichQueueStatus,
      enrichQueueError: null,
    })
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))

  scheduleCaptureEnrichWorker(userId)
  return { ok: true }
}
