/**
 * Tier 2: enrich a queued thought row in place using full user context.
 */
import { and, eq, sql } from 'drizzle-orm'
import { applyCaptureContentSplitIfNeeded } from '$lib/server/capture/apply-capture-content-split'
import { readCaptureIntent, type CaptureIntent } from '$lib/server/capture/capture-intent'
import { readCaptureSplitState } from '$lib/server/capture/content-role'
import { enrichThought, type EnrichThoughtOptions } from '$lib/server/capture/enrich'
import { drainCaptureEnrichQueue } from '$lib/server/capture/enrich-queue-drain'
import { extractEnrichThoughtBundle } from '$lib/server/capture/enrich-thought-bundle'
import {
  loadEnrichmentContext,
  type EnrichmentContext,
} from '$lib/server/capture/enrichment-context'
import {
  createIngestPhaseTimer,
  logIngestPhaseTiming,
  type IngestPhaseTimer,
} from '$lib/server/capture/phase-timing'
import { markEnrichQueueComplete, markEnrichQueueFailed } from '$lib/server/capture/queue-capture'
import { toPgVectorLiteral, type CaptureProgressEvent } from '$lib/server/capture/service'
import { decryptTenantValue, encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { runIngestWithRetries } from '$lib/server/ingest/retry'
import {
  resolveDecisionEnforceKinds,
  type EnforceableDecisionKind,
} from '$lib/server/llm/decision-client'
import {
  dominantEntityType,
  runEnforcedBoundedDecisions,
  runEnforcedPerItemDecisions,
  startDecisionShadow,
  startEarlyCaptureDecisions,
  type BoundedDecisionSpec,
  type EnforcedContentRole,
} from '$lib/server/llm/decision-plane'
import { createThoughtEmbedding } from '$lib/server/llm/embedding'
import type {
  ExtractedEntityMention,
  ExtractedEntityTriple,
} from '$lib/server/memory/entity-extraction'
import type { EntityGraphEnrichmentContext } from '$lib/server/memory/entity-graph-enrichment-context'
import { loadEntityGraphEnrichmentContext } from '$lib/server/memory/entity-graph-enrichment-context'
import type { RecallCues } from '$lib/server/memory/search-cues'
import type { ExtractedTemporalMention } from '$lib/server/memory/temporal-normalize'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'
import { validateEntityKindKeyForNewIngest } from '$lib/server/ontology-db/load-ontology'
import type { ResolvedThoughtOntologyKind } from '$lib/server/ontology/classify-thought-category'
import { InvalidThoughtCategoryError } from '$lib/server/ontology/validate-thought-category'
import { redactedText } from '$lib/server/security/detect-secrets'

export type EnrichQueuedThoughtOptions = {
  onProgress?: (event: CaptureProgressEvent) => Promise<void>
  ingestTimer?: IngestPhaseTimer
  /** Pre-loaded context (tests). */
  context?: EnrichmentContext
}

async function decryptQueuedRow(
  userId: string,
  row: {
    rawText: string
    normalizedText: string
    rawTextEncrypted: string | null
    normalizedTextEncrypted: string | null
  },
): Promise<{ rawText: string; normalizedText: string }> {
  const [rawText, normalizedText] = await Promise.all([
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
  ])
  return { rawText, normalizedText }
}

/** The row's decrypted metadata (empty when it has none). */
async function decryptRowMetadata(
  userId: string,
  row: { metadata?: unknown; metadataEncrypted?: string | null },
): Promise<Record<string, unknown>> {
  if (row.metadataEncrypted) {
    const json = await decryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: row.metadataEncrypted,
    })
    return JSON.parse(json) as Record<string, unknown>
  }
  return row.metadata && typeof row.metadata === 'object'
    ? { ...(row.metadata as Record<string, unknown>) }
    : {}
}

async function prefetchEnrichExtractions(input: {
  context: EnrichmentContext
  capturedAt: Date
}): Promise<{
  category: ResolvedThoughtOntologyKind
  embedding: number[]
  entityGraph: { mentions: ExtractedEntityMention[]; triples: ExtractedEntityTriple[] }
  entityEnrichmentContext?: EntityGraphEnrichmentContext
  recall: RecallCues
  temporalMentions: ExtractedTemporalMention[]
}> {
  const { context, capturedAt } = input
  const userId = context.userId
  const { normalizedText } = context

  const ontologyEntityKinds = context.ontology.entityKinds
    .filter((k) => k.active && k.kindType === 'entity_type')
    .map((k) => ({ key: k.key, name: k.name, definition: k.definition }))

  const anchorTimezone = await getUserPreferredTimezone(userId)

  if (isGraphScaleQuiet()) {
    console.info('[graph-scale] enrich prefetch: embedding')
  }
  const embedding = await createThoughtEmbedding(userId, normalizedText)

  let entityEnrichmentContext: EntityGraphEnrichmentContext | undefined
  if (ontologyEntityKinds.length > 0) {
    if (isGraphScaleQuiet()) {
      console.info('[graph-scale] enrich prefetch: entity context')
    }
    entityEnrichmentContext = await loadEntityGraphEnrichmentContext({
      userId,
      normalizedText,
      thoughtEmbedding: embedding,
      communityExcerpts: context.communityExcerpts,
      groundingProfile: context.groundingProfile,
    })
  }

  if (isGraphScaleQuiet()) {
    console.info('[graph-scale] enrich prefetch: enrich_thought_bundle')
  }
  const bundle = await extractEnrichThoughtBundle({
    context,
    capturedAt,
    timezone: anchorTimezone,
    entityEnrichmentContext,
    ontologyEntityKinds,
  })

  return {
    category: bundle.category,
    embedding,
    entityGraph: bundle.entityGraph,
    entityEnrichmentContext,
    recall: { cues: bundle.cues, askQuestion: bundle.askQuestion },
    temporalMentions: bundle.temporalMentions,
  }
}

/** O2 resolution: the Jev salience_band seeds the INITIAL salience once at enrich
 *  (high 1.5 / low 0.6); medium and absent keep the column default. Decay then stays
 *  purely deterministic (compute-salience) — idempotency preserved.
 *  See docs/planning/09-jev-decision-plane.md (batch-3 record, O2). */
export const INITIAL_SALIENCE_BY_PRIOR = { high: 1.5, low: 0.6 } as const

/**
 * Validates the ENFORCED decision-model category against the active ontology
 * and resolves its kind row. Off-catalog answers throw — no repair, no
 * fallback (spec P5): the ingest retry ladder owns recovery.
 */
function resolveEnforcedCategory(
  context: EnrichmentContext,
  enforced: { choice: string; probability: number; alternatives: Record<string, number> },
): ResolvedThoughtOntologyKind {
  const key = enforced.choice.trim()
  if (!validateEntityKindKeyForNewIngest(context.ontology, key)) {
    throw new InvalidThoughtCategoryError(
      `decision-model answer "${enforced.choice}" (authoritative per DECISION_ENFORCE_KINDS)`,
    )
  }
  const row = context.ontology.entityKindsByKey.get(key)
  if (!row) {
    throw new InvalidThoughtCategoryError(key)
  }
  const alternatives = Object.entries(enforced.alternatives)
    .map(([altKey, confidence]) => ({ key: altKey, confidence }))
    .sort((a, b) => b.confidence - a.confidence)
  return { key, ontologyEntityKindId: row.id, confidence: enforced.probability, alternatives }
}

/**
 * Whole-question specs for the enforced open_loop / salience_band kinds
 * (spec O2): the bounded questions asked about the capture as a whole. No
 * comparison primary exists on this surface — the bundle never answers these.
 */
function openLoopSalienceSpecs(
  enforceKinds: ReadonlySet<EnforceableDecisionKind>,
): BoundedDecisionSpec[] {
  const specs: BoundedDecisionSpec[] = []
  if (enforceKinds.has('open_loop')) {
    specs.push({
      decisionKind: 'open_loop',
      id: 'open_loop',
      question: {
        type: 'choice',
        instructions: 'Is this capture a live commitment, a mere mention of one, or already closed?',
        criteria: {
          actionable: 'A live commitment — the user intends to do this.',
          mentioned: 'Merely mentions a task or commitment without itself being one.',
          closed: 'A commitment already completed or closed off.',
        },
      },
      llmChoice: null,
    })
  }
  if (enforceKinds.has('salience_band')) {
    specs.push({
      decisionKind: 'salience_band',
      id: 'salience_band',
      question: {
        type: 'choice',
        instructions: 'How salient is this capture likely to be for later recall?',
        criteria: {
          high: 'Central, frequently-relevant material for this user.',
          medium: 'Ordinary everyday relevance.',
          low: 'Peripheral, ephemeral, or small-talk.',
        },
      },
      llmChoice: null,
    })
  }
  return specs
}

/**
 * Full enrich pipeline for one queued row: context → classify/embed → graph enrich.
 */
export async function enrichQueuedThought(
  userId: string,
  thoughtId: string,
  options?: EnrichQueuedThoughtOptions,
): Promise<void> {
  const onProgress = options?.onProgress
  const ingestTimer = options?.ingestTimer ?? createIngestPhaseTimer()
  const time = ingestTimer.time.bind(ingestTimer)

  try {
    await runIngestWithRetries(async () => {
      if (isGraphScaleQuiet()) {
        console.info('[graph-scale] enrich pipeline start', { userId, thoughtId })
      }
      const db = getDb()
      const [row] = await db
        .select({
          id: thought.id,
          rawText: thought.rawText,
          normalizedText: thought.normalizedText,
          rawTextEncrypted: thought.rawTextEncrypted,
          normalizedTextEncrypted: thought.normalizedTextEncrypted,
          createdAt: thought.createdAt,
          metadata: thought.metadata,
          metadataEncrypted: thought.metadataEncrypted,
        })
        .from(thought)
        .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
        .limit(1)

      if (!row) {
        throw new Error(`Queued thought not found: ${thoughtId}`)
      }

      // Secret hygiene (docs/planning/secret-hygiene.md): `raw_text` stays the user's verbatim
      // words in the database, but nothing below may see a credential — the content_role call,
      // the Phase-A split spans, the enrichment prompts, the embedding and the cues all work
      // from the redacted text. `normalized_text` is already redacted at capture; scanning it
      // again keeps rows captured before secret hygiene (until the scrub script runs) clean too.
      const stored = await decryptQueuedRow(userId, row)
      const rawText = redactedText(stored.rawText)
      const normalizedText = redactedText(stored.normalizedText)

      // Decision plane, enforced early decisions (spec §6 P): ONE bounded call BEFORE the split
      // phase asks content_role (personal | reference | mixed — drives the generation call) and
      // capture_intent (store | forget — a forget request removes memory instead of becoming it).
      // Throws into the ingest retry ladder on failure. Each is decided exactly once per capture:
      // a span child IS its span (never a request), a retried attempt resumes the persisted plan
      // and the persisted intent.
      const rowMetadata = await decryptRowMetadata(userId, row)
      const splitState = readCaptureSplitState(rowMetadata)
      const roleUndecided = splitState.phase === 'undecided'
      let captureIntent: CaptureIntent | undefined = readCaptureIntent(rowMetadata)
      const intentUndecided = roleUndecided && captureIntent === undefined
      const earlyDecision = startEarlyCaptureDecisions({
        userId,
        state: normalizedText,
        contentRole: roleUndecided,
        captureIntent: intentUndecided,
      })
      const early = earlyDecision
        ? await time('decision_content_role', () => earlyDecision.decide())
        : undefined
      const enforcedContentRole: EnforcedContentRole | undefined = early?.contentRole
      if (early?.captureIntent) {
        captureIntent = early.captureIntent.intent
        await persistCaptureIntent(userId, thoughtId, captureIntent)
      }

      // Forget request (docs/planning/personamem-score-plan.md, S2): the capture asks Eigen to
      // forget something. It removes memory instead of becoming memory — no split, no embedding,
      // no enrichment — and is archived once the targets are handled. A failure throws into the
      // retry ladder; nothing here falls back to storing it.
      if (captureIntent === 'forget') {
        const { applyForgetRequest } = await import('$lib/server/capture/apply-forget-request')
        await time('forget_request', () =>
          applyForgetRequest({
            userId,
            captureThoughtId: thoughtId,
            captureCreatedAt: row.createdAt,
            request: normalizedText,
          }),
        )
        return
      }

      await onProgress?.({ parallel: false, phase: 'content_split' })
      const splitApplied = await time('content_split', () =>
        applyCaptureContentSplitIfNeeded({
          userId,
          thoughtId,
          rawText,
          existingNormalizedText: normalizedText,
          decidedRole: enforcedContentRole?.role,
        }),
      )

      const context =
        options?.context ??
        (await time('load_enrichment_context', () =>
          loadEnrichmentContext({
            userId,
            thoughtId,
            normalizedText: splitApplied.normalizedText,
            // never the whole capture of a split thought: the spans/note it gave away
            // belong to other thoughts and must not feed this one's entities or cues
            rawText: splitApplied.enrichRawText,
          }),
        ))

      await onProgress?.({ parallel: false, phase: 'ontology' })
      await onProgress?.({ parallel: false, phase: 'embedding' })

      // Decision shadow: kick BEFORE the bundle LLM call so both models run side by side.
      // capture_intent rides along only when it is undecided and NOT enforced (shadow): the
      // pipeline stores the capture, which is the comparison primary.
      const captureIntentShadow = intentUndecided && !resolveDecisionEnforceKinds().has('capture_intent')
      const decisionShadow = startDecisionShadow({
        userId,
        surface: 'enrich_queued',
        state: context.normalizedText,
        categoryKinds: context.ontology.entityKinds
          .filter((k) => k.active && k.kindType === 'thought_category')
          .map((k) => ({ key: k.key, name: k.name, definition: k.definition })),
        entityTypeKinds: context.ontology.entityKinds
          .filter((k) => k.active && k.kindType === 'entity_type')
          .map((k) => ({ key: k.key, name: k.name, definition: k.definition })),
        contentRoleEnabled: roleUndecided,
        enforcedContentRole,
        captureIntentShadow,
      })

      const prefetched = await time('prefetch_enrich_llm', () =>
        prefetchEnrichExtractions({ context, capturedAt: row.createdAt }),
      )

      // Enforced per-mention entity typing (spec §8 O1): one Decisions call
      // asking the bounded entity_type question once per extracted mention.
      // The decision model's answer replaces the bundle's mention typing
      // before the graph is persisted. No try/catch — a failure or
      // off-catalog answer throws into the ingest retry ladder (an enforced
      // decision has no fallback, no silent skip).
      if (resolveDecisionEnforceKinds().has('entity_type') && prefetched.entityGraph.mentions.length > 0) {
        await time('decision_entity_type', async () => {
          const entityTypeKinds = context.ontology.entityKinds
            .filter((k) => k.active && k.kindType === 'entity_type')
            .map((k) => ({ key: k.key, name: k.name, definition: k.definition }))
          const answers = await runEnforcedPerItemDecisions({
            userId,
            surface: 'enrich_queued',
            kind: 'entity_type',
            state: context.normalizedText,
            criteria: Object.fromEntries(
              entityTypeKinds.map((k) => [k.key, `${k.name}: ${k.definition}`.trim()]),
            ),
            items: prefetched.entityGraph.mentions.map((mention, index) => ({
              ref: `m${index + 1}`,
              instructions: `Which ontology entity type best matches the mention "${mention.surface}" in this captured thought?`,
              llmChoice: mention.entityType,
              llmConfidence: mention.confidence,
            })),
          })
          prefetched.entityGraph.mentions = prefetched.entityGraph.mentions.map((mention, index) => {
            const answer = answers.get(`m${index + 1}`)
            return answer
              ? { ...mention, entityType: answer.choice, confidence: answer.probability }
              : mention
          })
        })
      }

      const bundleCategory = prefetched.category
      // Settle the decision plane beside the bundle. An ENFORCED category
      // answer overrides the bundle's before persist (roles reversed, spec
      // P5); otherwise the bundle's decision stays authoritative.
      const settled = await decisionShadow?.({
        category: { choice: bundleCategory.key, confidence: bundleCategory.confidence },
        contentRole: enforcedContentRole ? undefined : { choice: splitApplied.role },
        entityType: dominantEntityType(prefetched.entityGraph.mentions) ?? undefined,
        captureIntent: captureIntentShadow ? { choice: 'store' } : undefined,
      })
      const category = settled?.category
        ? resolveEnforcedCategory(context, settled.category)
        : bundleCategory

      // Enforced whole-question open_loop / salience_band (spec O2): ONE
      // Decisions call asking only the kinds DECISION_ENFORCE_KINDS selects.
      // Answers persist as metadata in the classify/embed patch below (no
      // schema change); a high/low salience band additionally seeds the
      // thought's initial salienceScore (O2 one-time prior). No try/catch —
      // a failure or off-catalog answer throws into the ingest retry ladder
      // (an enforced decision has no fallback, no silent skip).
      const enforceKinds = resolveDecisionEnforceKinds()
      const boundedSpecs = openLoopSalienceSpecs(enforceKinds)
      let openLoop: string | undefined
      let saliencePrior: string | undefined
      if (boundedSpecs.length > 0) {
        const answers = await time('decision_open_loop_salience', () =>
          runEnforcedBoundedDecisions({
            userId,
            surface: 'enrich_queued',
            state: context.normalizedText,
            specs: boundedSpecs,
          }),
        )
        if (enforceKinds.has('open_loop')) {
          const answer = answers.get('open_loop')
          if (!answer) {
            throw new Error('[enrich-queued] enforced open_loop decision returned no answer')
          }
          openLoop = answer.choice
        }
        if (enforceKinds.has('salience_band')) {
          const answer = answers.get('salience_band')
          if (!answer) {
            throw new Error('[enrich-queued] enforced salience_band decision returned no answer')
          }
          saliencePrior = answer.choice
        }
      }

      // O2 one-time salience prior: a high/low Jev band seeds the thought's
      // INITIAL salienceScore here at enrich; medium and absent leave the
      // column default (1.0) in place. No recurring influence — decay from
      // then on is purely deterministic (compute-salience).
      const initialSalience =
        saliencePrior !== undefined && saliencePrior in INITIAL_SALIENCE_BY_PRIOR
          ? INITIAL_SALIENCE_BY_PRIOR[saliencePrior as keyof typeof INITIAL_SALIENCE_BY_PRIOR]
          : undefined

      await time('persist_classify_embed', async () => {
        await db
          .update(thought)
          .set({
            category: category.key,
            ontologyEntityKindId: category.ontologyEntityKindId,
            embedding: sql`${toPgVectorLiteral(prefetched.embedding)}::vector`,
            ...(initialSalience !== undefined ? { salienceScore: initialSalience } : {}),
            metadataEncrypted: await encryptMetadataPatch(userId, thoughtId, {
              categorySource: settled?.category ? 'decision_model' : 'llm',
              categoryConfidence: category.confidence,
              categoryAlternatives: category.alternatives,
              enrichmentContext: context.completeness,
              ...(openLoop !== undefined ? { openLoop } : {}),
              ...(saliencePrior !== undefined ? { saliencePrior } : {}),
            }),
          })
          .where(eq(thought.id, thoughtId))
      })

      const [countRow] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(thought)
        .where(eq(thought.userId, userId))
      const thoughtCountAfterInsert = Number(countRow?.n ?? 0)

      const enrichOpts: EnrichThoughtOptions = {
        onProgress,
        thoughtEmbedding: prefetched.embedding,
        thoughtCountAfterInsert,
        preloadedKnownEntities: context.knownEntities,
        precomputedEntityGraph: prefetched.entityGraph,
        precomputedEntityEnrichmentContext: prefetched.entityEnrichmentContext,
        precomputedRecall: prefetched.recall,
        precomputedTemporalMentions: prefetched.temporalMentions,
        ingestTimer,
        deferRelations: true,
      }

      await enrichThought(userId, thoughtId, splitApplied.normalizedText, enrichOpts)

      const [enrichedRow] = await getDb()
        .select({ enrichedAt: thought.enrichedAt })
        .from(thought)
        .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
        .limit(1)
      if (!enrichedRow?.enrichedAt) {
        throw new Error('Enrichment finished without setting enriched_at')
      }
    })

    await markEnrichQueueComplete(thoughtId)

    const [enrichedThought] = await getDb()
      .select({
        normalizedText: thought.normalizedText,
        category: thought.category,
        enrichedAt: thought.enrichedAt,
      })
      .from(thought)
      .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
      .limit(1)

    if (enrichedThought?.enrichedAt) {
      const { notifyThoughtEnriched } = await import('$lib/server/agents/notify')
      const { loadProjectContextForThought } = await import('$lib/server/agents/project-context')
      const projectCtx = await loadProjectContextForThought(userId, thoughtId)
      notifyThoughtEnriched({
        userId,
        thoughtId,
        normalizedText: enrichedThought.normalizedText,
        category: enrichedThought.category,
        enrichedAt: enrichedThought.enrichedAt,
        projectEntityIds: projectCtx.projectEntityIds,
        projectLabels: projectCtx.projectLabels,
      })
    }

    logIngestPhaseTiming({
      userId,
      thoughtId,
      timing: ingestTimer.finish(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isGraphScaleQuiet()) {
      console.error('[enrich-queued] failed', { userId, thoughtId, message })
    } else {
      console.error('[graph-scale] enrich failed', { userId, thoughtId, message })
    }
    await markEnrichQueueFailed(thoughtId, message)
    throw err
  }
}

/** Persists the decided capture intent so a retried attempt resumes it instead of asking again. */
async function persistCaptureIntent(
  userId: string,
  thoughtId: string,
  intent: CaptureIntent,
): Promise<void> {
  await getDb()
    .update(thought)
    .set({ metadataEncrypted: await encryptMetadataPatch(userId, thoughtId, { captureIntent: intent }) })
    .where(eq(thought.id, thoughtId))
}

async function encryptMetadataPatch(
  userId: string,
  thoughtId: string,
  patch: Record<string, unknown>,
): Promise<string> {
  const db = getDb()
  const [existing] = await db
    .select({ metadata: thought.metadata, metadataEncrypted: thought.metadataEncrypted })
    .from(thought)
    .where(eq(thought.id, thoughtId))
    .limit(1)

  let base: Record<string, unknown> = {}
  if (existing?.metadataEncrypted) {
    const json = await decryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: existing.metadataEncrypted,
    })
    base = JSON.parse(json) as Record<string, unknown>
  } else if (existing?.metadata && typeof existing.metadata === 'object') {
    base = { ...(existing.metadata as Record<string, unknown>) }
  }

  return encryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    plaintext: JSON.stringify({ ...base, ...patch }),
  })
}

/** Drain all pending rows for a user (eval / admin). */
export async function processCaptureEnrichQueue(
  userId: string,
  options?: import('$lib/server/capture/enrich-queue-drain').DrainCaptureEnrichQueueOptions,
): Promise<number> {
  return drainCaptureEnrichQueue(userId, options)
}
