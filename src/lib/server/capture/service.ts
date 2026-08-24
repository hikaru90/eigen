import { and, desc, eq, gte, lte, lt, or, sql } from 'drizzle-orm'
import type { CaptureIngestPhase } from '$lib/capture/ingest-phases'
import {
  applyThoughtEditRequest,
  parseLifecycleEditRequest,
} from '$lib/server/capture/apply-thought-edit'
import { getDb } from '$lib/server/db'
import { temporalEvent, thought, thoughtEntity } from '$lib/server/db/schema'
import { removeThoughtGraphArtifacts, upsertThoughtNode } from '$lib/server/graph/age'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import { pruneCanonicalEntitiesWithNoThoughtLinks } from '$lib/server/memory/canonical-entity-admin'
import { computeLexicalText } from '$lib/server/memory/lexical-text'
import { setThoughtLifecycleStatus } from '$lib/server/memory/lifecycle'
import { activeThoughtLifecycleCondition } from '$lib/server/memory/thought-lifecycle-filter'
import { resolveThoughtCategory } from '$lib/server/ontology'
import { ensureUserOntologySeeded } from '$lib/server/ontology-db'
export { setThoughtLifecycleStatus }
import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
import { loadThoughtCaptureResult } from '$lib/server/capture/capture-result'
import {
  createEditPhaseTimer,
  logEditComplete,
  logEditFailure,
  truncateEditPreview,
} from '$lib/server/capture/edit-phase-timing'
import { reenrichThought } from '$lib/server/capture/enrich'
import { enrichQueuedThought } from '$lib/server/capture/enrich-queued-thought'
import { logIngestPhaseTiming, type IngestPhaseTimer } from '$lib/server/capture/phase-timing'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import type { CaptureSource, MemoryAuthor } from '$lib/server/db/schema'
import { resolveAuthorSqlCondition } from '$lib/server/memory/authorship'

/** Deterministic text shaping only; kind key + FK come from `resolveThoughtCategory`. */
export function normalizeThoughtText(raw: string): {
  normalized: string
  metadata: Record<string, unknown>
} {
  const normalized = raw.trim().replace(/\s+/g, ' ')
  return {
    normalized,
    metadata: { pipeline: 'ontology_llm_v1' },
  }
}

export function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

/** A single sequential phase or a parallel group of phases running concurrently. */
export type CaptureProgressEvent =
  { parallel: false; phase: CaptureIngestPhase } | { parallel: true; phases: CaptureIngestPhase[] }

async function emitProgress(
  onProgress: ((event: CaptureProgressEvent) => Promise<void>) | undefined,
  phase: CaptureIngestPhase,
) {
  await onProgress?.({ parallel: false, phase })
}

export type CaptureThoughtOptions = {
  onProgress?: (event: CaptureProgressEvent) => Promise<void>
  /** When set, records per-step ingest durations (also logs `[capture.timing]` on completion). */
  ingestTimer?: IngestPhaseTimer
  /**
   * When true, run full enrichment inline before returning (eval harness, tests).
   * Default false: queue row and return immediately; background worker enriches.
   */
  awaitEnrichment?: boolean
  source?: CaptureSource
  author?: MemoryAuthor
  authorLabel?: string | null
  authorKeyId?: string | null
  /** Override thought.createdAt for temporal anchoring at enrich (external drivers, eval fixtures). */
  capturedAt?: Date
}

async function decryptThoughtRow<
  T extends {
    rawText: string
    rawTextEncrypted?: string | null
    normalizedText: string
    normalizedTextEncrypted?: string | null
    metadata: Record<string, unknown>
    metadataEncrypted?: string | null
  },
>(userId: string, row: T): Promise<T> {
  const [rawText, normalizedText, metadataJson] = await Promise.all([
    row.rawTextEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'raw_text',
          ciphertext: row.rawTextEncrypted,
        })
      : Promise.resolve(row.rawText),
    row.normalizedTextEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : Promise.resolve(row.normalizedText),
    row.metadataEncrypted
      ? decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : Promise.resolve(JSON.stringify(row.metadata ?? {})),
  ])
  return {
    ...row,
    rawText,
    normalizedText,
    metadata: JSON.parse(metadataJson) as Record<string, unknown>,
  }
}

/**
 * Capture: queue full-text row (fast) → optional await enrich → return result.
 *
 * Default: insert row with `enrich_queue_status=pending`, schedule background worker, return.
 * With `awaitEnrichment: true`: enrich inline on same row (eval / tests).
 */
export async function captureThought(
  userId: string,
  rawInput: string,
  options?: CaptureThoughtOptions,
): Promise<CaptureSubmitResult> {
  const onProgress = options?.onProgress
  const awaitEnrichment = options?.awaitEnrichment === true
  const ingestTimer = options?.ingestTimer
  const source = options?.source ?? 'api'

  await emitProgress(onProgress, 'accounting')
  await emitProgress(onProgress, 'session')
  await emitProgress(onProgress, 'persist')

  const queued = await queueCapture(userId, rawInput, {
    source,
    author: options?.author,
    authorLabel: options?.authorLabel,
    authorKeyId: options?.authorKeyId,
    skipWorker: awaitEnrichment,
    capturedAt: options?.capturedAt,
  })

  if (awaitEnrichment) {
    await enrichQueuedThought(userId, queued.thoughtId, { onProgress, ingestTimer })
  } else {
    await emitProgress(onProgress, 'graph')
  }

  const result = await loadThoughtCaptureResult(userId, queued.thoughtId)
  if (ingestTimer) {
    logIngestPhaseTiming({
      userId,
      thoughtId: result.id,
      timing: ingestTimer.finish(),
    })
  }
  return result
}

export type EditStoredThoughtOptions = {
  onProgress?: (event: CaptureProgressEvent) => Promise<void>
}

export async function editStoredThought(
  userId: string,
  thoughtId: string,
  editRequest: string,
  options?: EditStoredThoughtOptions,
) {
  const onProgress = options?.onProgress
  const logCtx = { userId, thoughtId }
  const timer = createEditPhaseTimer(logCtx)
  const editRequestPreview = truncateEditPreview(editRequest)

  console.info('[capture.edit] start', { ...logCtx, editRequestPreview })

  try {
    await timer.time('ensure_ontology_seeded', async () => {
      await ensureUserOntologySeeded(getDb(), userId)
    })
    await emitProgress(onProgress, 'accounting')

    const existing = await timer.time('load_existing', async () => {
      const [row] = await getDb()
        .select()
        .from(thought)
        .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
        .limit(1)
      return row ?? null
    })

    if (!existing) {
      console.error('[capture.edit] not found', logCtx)
      return { ok: false as const, reason: 'not_found' as const }
    }

    const decryptedExisting = await timer.time('decrypt_existing', async () =>
      decryptThoughtRow(userId, existing),
    )

    const lifecycleStatus = parseLifecycleEditRequest(editRequest)
    if (lifecycleStatus) {
      console.info('[capture.edit] lifecycle fast path', { ...logCtx, lifecycleStatus })
      const lifecycleResult = await timer.time('lifecycle_status', async () =>
        setThoughtLifecycleStatus(userId, thoughtId, lifecycleStatus),
      )
      if (!lifecycleResult.ok) {
        console.error('[capture.edit] not found', logCtx)
        return lifecycleResult
      }
      const lifecycleMeta = (lifecycleResult.thought.metadata as Record<string, unknown>) ?? {}
      const editSummary =
        typeof lifecycleMeta.lastEditSummary === 'string'
          ? lifecycleMeta.lastEditSummary
          : 'Status updated'
      logEditComplete({
        logCtx,
        path: 'lifecycle_only',
        textChanged: false,
        nextStatus: lifecycleStatus,
        editSummary,
        timing: timer.finish(),
      })
      return {
        ok: true as const,
        thought: lifecycleResult.thought,
        editSummary,
      }
    }

    const applied = await timer.time('llm_apply_edit', async () =>
      applyThoughtEditRequest({
        userId,
        existingRawText: decryptedExisting.rawText,
        existingNormalizedText: decryptedExisting.normalizedText,
        category: decryptedExisting.category,
        editRequest,
      }),
    )

    const priorMeta = (decryptedExisting.metadata as Record<string, unknown>) ?? {}
    const editedRaw = applied.rawText
    const rawTextChanged = editedRaw !== decryptedExisting.rawText
    const normalizedUnchanged =
      normalizeThoughtText(editedRaw).normalized === decryptedExisting.normalizedText
    const priorStatus = typeof priorMeta.status === 'string' ? priorMeta.status : 'open'
    const nextStatus = applied.status ?? priorStatus
    const statusOnlyChange = nextStatus !== priorStatus && normalizedUnchanged
    const textChanged = rawTextChanged && !statusOnlyChange

    console.info('[capture.edit] llm outcome', {
      ...logCtx,
      rawTextChanged,
      normalizedUnchanged,
      statusOnlyChange,
      textChanged,
      priorStatus,
      nextStatus,
      editSummary: applied.summary,
    })

    if (statusOnlyChange && rawTextChanged) {
      console.warn('[capture.edit] ignored LLM rawText rewrite on status-only change', logCtx)
    }

    const metadataPatch: Record<string, unknown> = {
      ...priorMeta,
      lastEditRequest: editRequest.trim(),
      lastEditSummary: applied.summary,
      status: nextStatus,
      ...(nextStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
    }

    if (!textChanged) {
      const lifecycleValues = new Set(['open', 'completed', 'archived'])
      if (lifecycleValues.has(nextStatus)) {
        const lifecycleResult = await timer.time('lifecycle_status', async () =>
          setThoughtLifecycleStatus(
            userId,
            thoughtId,
            nextStatus as 'open' | 'completed' | 'archived',
          ),
        )
        if (!lifecycleResult.ok) {
          return lifecycleResult
        }
        logEditComplete({
          logCtx,
          path: 'metadata_only',
          textChanged,
          nextStatus,
          editSummary: applied.summary,
          timing: timer.finish(),
        })
        return {
          ok: true as const,
          thought: lifecycleResult.thought,
          editSummary: applied.summary,
        }
      }

      await emitProgress(onProgress, 'persist')
      await timer.time('persist_metadata', async () => {
        const metadataEncrypted = await timer.time('encrypt_metadata', async () =>
          encryptTenantValue({
            userId,
            table: 'thought',
            column: 'metadata',
            plaintext: JSON.stringify(metadataPatch),
          }),
        )
        const [row] = await getDb()
          .update(thought)
          .set({
            metadata: metadataPatch,
            metadataEncrypted,
            updatedAt: new Date(),
          })
          .where(eq(thought.id, thoughtId))
          .returning({
            id: thought.id,
            userId: thought.userId,
            rawText: thought.rawText,
            rawTextEncrypted: thought.rawTextEncrypted,
            normalizedText: thought.normalizedText,
            normalizedTextEncrypted: thought.normalizedTextEncrypted,
            lexicalText: thought.lexicalText,
            category: thought.category,
            metadata: thought.metadata,
            metadataEncrypted: thought.metadataEncrypted,
          })
        if (!row) {
          throw new Error(`persist_metadata returned no row for thought ${thoughtId}`)
        }
        return row
      })

      const resultThought = await timer.time('load_result', async () =>
        loadThoughtCaptureResult(userId, thoughtId),
      )

      logEditComplete({
        logCtx,
        path: 'metadata_only',
        textChanged,
        nextStatus,
        editSummary: applied.summary,
        timing: timer.finish(),
      })

      return {
        ok: true as const,
        thought: resultThought,
        editSummary: applied.summary,
      }
    }

    const { normalized, metadata: baseMeta } = await timer.time('normalize_text', async () =>
      normalizeThoughtText(editedRaw),
    )
    await emitProgress(onProgress, 'ontology')
    const {
      key: category,
      ontologyEntityKindId,
      confidence: categoryConfidence,
      alternatives: categoryAlternatives,
    } = await timer.time('classify_category', async () =>
      resolveThoughtCategory({
        userId,
        normalized,
        rawText: editedRaw,
      }),
    )
    const metadata = {
      ...metadataPatch,
      ...baseMeta,
      categorySource: 'llm',
      categoryConfidence,
      categoryAlternatives,
    }
    const lexicalText = computeLexicalText(normalized)
    await emitProgress(onProgress, 'embedding')
    const embedding = await timer.time('embedding', async () =>
      createThoughtEmbedding(userId, normalized),
    )
    const [rawTextEncrypted, normalizedTextEncrypted, metadataEncrypted] = await timer.time(
      'encrypt_columns',
      async () =>
        Promise.all([
          encryptTenantValue({
            userId,
            table: 'thought',
            column: 'raw_text',
            plaintext: editedRaw,
          }),
          encryptTenantValue({
            userId,
            table: 'thought',
            column: 'normalized_text',
            plaintext: normalized,
          }),
          encryptTenantValue({
            userId,
            table: 'thought',
            column: 'metadata',
            plaintext: JSON.stringify(metadata),
          }),
        ]),
    )

    await emitProgress(onProgress, 'persist')
    const updated = await timer.time('persist_text_change', async () => {
      const [row] = await getDb()
        .update(thought)
        .set({
          rawText: editedRaw,
          rawTextEncrypted,
          normalizedText: normalized,
          normalizedTextEncrypted,
          lexicalText,
          embedding: sql`${toPgVectorLiteral(embedding)}::vector`,
          category,
          ontologyEntityKindId,
          enrichedAt: null,
          metadata,
          metadataEncrypted,
          updatedAt: new Date(),
        })
        .where(eq(thought.id, thoughtId))
        .returning({
          id: thought.id,
          userId: thought.userId,
          rawText: thought.rawText,
          rawTextEncrypted: thought.rawTextEncrypted,
          normalizedText: thought.normalizedText,
          normalizedTextEncrypted: thought.normalizedTextEncrypted,
          lexicalText: thought.lexicalText,
          category: thought.category,
          metadata: thought.metadata,
          metadataEncrypted: thought.metadataEncrypted,
        })
      if (!row) {
        throw new Error(`persist_text_change returned no row for thought ${thoughtId}`)
      }
      return row
    })
    const decryptedUpdated = await timer.time('decrypt_updated', async () =>
      decryptThoughtRow(userId, updated),
    )

    const priorLifecycle = existing.lifecycleStatus ?? 'open'
    const lifecycleValues = new Set(['open', 'completed', 'archived'])
    const nextLifecycle = lifecycleValues.has(nextStatus)
      ? (nextStatus as 'open' | 'completed' | 'archived')
      : priorLifecycle

    if (nextLifecycle !== priorLifecycle) {
      const lifecycleResult = await timer.time('lifecycle_status', async () =>
        setThoughtLifecycleStatus(userId, thoughtId, nextLifecycle),
      )
      if (!lifecycleResult.ok) {
        return lifecycleResult
      }
      if (nextLifecycle === 'open') {
        await timer.time('reenrich', async () => {
          await reenrichThought(userId, decryptedUpdated.id, decryptedUpdated.normalizedText, {
            onProgress,
            thoughtEmbedding: embedding,
          })
        })
      }
      logEditComplete({
        logCtx,
        path: 'full_reenrich',
        textChanged,
        nextStatus: nextLifecycle,
        editSummary: applied.summary,
        timing: timer.finish(),
      })
      return {
        ok: true as const,
        thought: lifecycleResult.thought,
        editSummary: applied.summary,
      }
    }

    await emitProgress(onProgress, 'graph')
    await timer.time('upsert_graph_node', async () => {
      await upsertThoughtNode({
        id: updated.id,
        userId,
        category: updated.category,
      })
    })

    await timer.time('reenrich', async () => {
      await reenrichThought(userId, decryptedUpdated.id, decryptedUpdated.normalizedText, {
        onProgress,
        thoughtEmbedding: embedding,
      })
    })

    const resultThought = await timer.time('load_result', async () =>
      loadThoughtCaptureResult(userId, thoughtId),
    )

    logEditComplete({
      logCtx,
      path: 'full_reenrich',
      textChanged,
      nextStatus,
      editSummary: applied.summary,
      timing: timer.finish(),
    })

    return {
      ok: true as const,
      thought: resultThought,
      editSummary: applied.summary,
    }
  } catch (err) {
    logEditFailure({
      logCtx,
      err,
      timing: timer.finish(),
      editRequestPreview,
    })
    throw err
  }
}

export type RelinkThoughtGraphOptions = {
  onProgress?: (event: CaptureProgressEvent) => Promise<void>
}

/**
 * Re-runs relation + entity graph sync for an existing thought without changing
 * stored text. Clears outgoing AGE graph edges first so removed links don't linger.
 */
export async function relinkThoughtGraph(
  userId: string,
  thoughtId: string,
  options?: RelinkThoughtGraphOptions,
) {
  const onProgress = options?.onProgress
  await ensureUserOntologySeeded(getDb(), userId)
  await emitProgress(onProgress, 'accounting')

  const [existing] = await getDb()
    .select()
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!existing) {
    return { ok: false as const, reason: 'not_found' as const }
  }

  const decryptedExisting = await decryptThoughtRow(userId, existing)

  // Sync the node first (fast, no LLM).
  await emitProgress(onProgress, 'graph')
  await upsertThoughtNode({
    id: existing.id,
    userId,
    category: existing.category,
  })

  await reenrichThought(userId, decryptedExisting.id, decryptedExisting.normalizedText, {
    onProgress,
  })

  return {
    ok: true as const,
    thought: await loadThoughtCaptureResult(userId, thoughtId),
  }
}

/**
 * Removes a thought from AGE (edges, vertex, linked events), deletes the Postgres row
 * (cascades `thought_relation`, `entity_resolution_log`, `thought_entity`, `temporal_event`),
 * then prunes canonical entities that were only linked to this thought.
 */
export async function deleteThoughtForUser(userId: string, thoughtId: string) {
  await ensureUserOntologySeeded(getDb(), userId)

  const [existing] = await getDb()
    .select({ id: thought.id })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)

  if (!existing) {
    return { ok: false as const, reason: 'not_found' as const }
  }

  const linkedEntityRows = await getDb()
    .select({ entityId: thoughtEntity.entityId })
    .from(thoughtEntity)
    .where(and(eq(thoughtEntity.userId, userId), eq(thoughtEntity.thoughtId, existing.id)))
  const linkedEntityIds = linkedEntityRows.map((row) => row.entityId)

  const temporalRows = await getDb()
    .select({ id: temporalEvent.id, graphNodeId: temporalEvent.graphNodeId })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, existing.id)))
  const temporalEventGraphIds = temporalRows.map((row) => row.graphNodeId?.trim() || row.id)

  const { loadProjectContextForThought } = await import('$lib/server/agents/project-context')
  const projectCtx = await loadProjectContextForThought(userId, existing.id)

  await removeThoughtGraphArtifacts({
    userId,
    thoughtId: existing.id,
    temporalEventGraphIds,
  })

  await getDb()
    .delete(thought)
    .where(and(eq(thought.id, existing.id), eq(thought.userId, userId)))

  await pruneCanonicalEntitiesWithNoThoughtLinks(userId, linkedEntityIds)

  const { notifyThoughtDeleted } = await import('$lib/server/agents/notify')
  notifyThoughtDeleted({
    userId,
    thoughtId: existing.id,
    projectEntityIds: projectCtx.projectEntityIds,
    projectLabels: projectCtx.projectLabels,
  })

  return { ok: true as const }
}

async function decryptThoughtSnippetRow<
  T extends {
    normalizedText: string
    normalizedTextEncrypted?: string | null
  },
>(userId: string, row: T): Promise<T> {
  const normalizedText = row.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: row.normalizedTextEncrypted,
      })
    : row.normalizedText
  return { ...row, normalizedText }
}

export async function listThoughts(
  userId: string,
  options?: {
    limit?: number
    fields?: 'snippet' | 'full'
    cursor?: { createdAt: Date; id: string }
    authorFilter?: MemoryAuthor
    authorLayerKey?: string | null
    categoryFilter?: string
    dateFrom?: Date
    dateTo?: Date
  },
) {
  const limit = Math.max(1, Math.min(options?.limit ?? 20, 100))
  const fields = options?.fields ?? 'full'
  const cursor = options?.cursor
  const authorFilter = options?.authorFilter
  const authorLayerKey = options?.authorLayerKey
  const categoryFilter = options?.categoryFilter
  const dateFrom = options?.dateFrom
  const dateTo = options?.dateTo

  const authorSql = resolveAuthorSqlCondition(
    {
      author: thought.author,
      authorKeyId: thought.authorKeyId,
      authorLabel: thought.authorLabel,
    },
    { author: authorFilter, authorLayerKey },
  )

  const conditions = [
    eq(thought.userId, userId),
    activeThoughtLifecycleCondition(),
    authorSql,
    categoryFilter ? eq(thought.category, categoryFilter) : undefined,
    dateFrom ? gte(thought.createdAt, dateFrom) : undefined,
    dateTo ? lte(thought.createdAt, dateTo) : undefined,
    cursor
      ? or(
          lt(thought.createdAt, cursor.createdAt),
          and(eq(thought.createdAt, cursor.createdAt), lt(thought.id, cursor.id)),
        )
      : undefined,
  ]

  if (fields === 'snippet') {
    const rows = await getDb()
      .select({
        id: thought.id,
        normalizedText: thought.normalizedText,
        normalizedTextEncrypted: thought.normalizedTextEncrypted,
        category: thought.category,
        author: thought.author,
        authorLabel: thought.authorLabel,
        authorKeyId: thought.authorKeyId,
        createdAt: thought.createdAt,
      })
      .from(thought)
      .where(and(...conditions))
      .orderBy(desc(thought.createdAt), desc(thought.id))
      .limit(limit)
    return Promise.all(rows.map((row) => decryptThoughtSnippetRow(userId, row)))
  }

  const rows = await getDb()
    .select({
      id: thought.id,
      userId: thought.userId,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
      createdAt: thought.createdAt,
      updatedAt: thought.updatedAt,
    })
    .from(thought)
    .where(and(...conditions))
    .orderBy(desc(thought.createdAt), desc(thought.id))
    .limit(limit)
  return Promise.all(rows.map((row) => decryptThoughtRow(userId, row)))
}
