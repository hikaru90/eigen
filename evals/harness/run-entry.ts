/**
 * DB-backed eval runner: one entry at a time through real capture / retrieval / answer paths.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { user } from '$lib/server/db/auth.schema'
import { captureThought, editStoredThought } from '$lib/server/capture/service'
import { reenrichThought } from '$lib/server/capture/enrich'
import { composeAnswer } from '$lib/server/qa/compose-answer'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/brain.schema'
import type { EvalEntry } from '$lib/server/db/brain.schema'
import {
  appendEvalEvent,
  deleteEvalUserRow,
  getCorpusFixtureMap,
  getEvalRunRow,
  getThoughtMap,
  insertEvalUserRow,
  listEvalEntries,
  updateEvalEntry,
  updateEvalRunStatus,
  upsertThoughtMap,
  type CorpusFixtureRef,
} from '$lib/eval/store'
import { logEval, withEvalDb, type WithEvalDbOptions } from './eval-context'
import { EVAL_JUDGE_USER_ID } from './eval-config'
import { shouldReuseCorpusCapture } from './corpus-reuse'
import { buildCaptureFidelityJudgeInput } from './capture-eval-fidelity-input'
import { judgeCaptureFidelity } from './capture-fidelity'
import { judgeAnswerAcceptance } from './judge-acceptance'
import { runRetrievalSweepForQuery } from './retrieval-sweep'
import type { EvalRetrievalQuery, QaChecks } from './qa-types'
import { captureEvalGraphSnapshot } from './graph-snapshot'
import {
  ingestBrokenFromCheckAssertions,
  qaIdFromRetrievalFixtureRef,
  runtimeRetrievalRelevant,
} from './auto-retrieval-prune'
import { assessCorpusThoughtReuseHealth, invalidateCorpusFixture } from './corpus-fixture-health'
import { runStructuralChecks } from './qa-checks'
import type { CheckAssertionResult } from './qa-types'
import {
  assertThoughtEntitiesResolved,
  fixtureIdsRequiringEnrichment,
  loadThoughtEnrichmentTargets,
  waitForThoughtEnrichment,
  waitForThoughtEnrichmentComplete,
} from './wait-enrichment'
import {
  allBrokenFixtureIds,
  fixtureIdsRequiringEntityResolution,
  planIngestRetries,
  purgeCorpusFixtures,
  resetEvalEntriesForRetry,
  resolveIngestRetryMax,
} from './ingest-retry'
import { storedTextReflectsEdit } from './edit-verification'
import { mapWithConcurrency, resolveEvalEntryConcurrency } from './concurrency'
import { collectNextWave } from './eval-waves'
import {
  EvalRunStoppedError,
  assertEvalRunNotStopped,
  isEvalRunStopRequested,
} from '$lib/eval/run-cancel'
import { resolveEntryTimeoutMs, withEvalEntryTimeout } from './entry-timeout'
import { generateRunSynthesis, type EntrySummary } from './synthesis'
import { aggregateRunScores, isRunScorePassing } from '$lib/eval/display'
import type { EvalEntrySummary, EvalSynthesis } from '$lib/eval/types'
import { runWithTrace } from '$lib/server/activity/trace-context'

function evalBillingOpts(operatorUserId: string): WithEvalDbOptions {
  return { billingUserId: operatorUserId }
}

async function ensureJudgeUser(): Promise<void> {
  const db = getDb()
  const existing = await db.select().from(user).where(eq(user.id, EVAL_JUDGE_USER_ID))
  if (existing.length > 0) return
  await insertEvalUserRow(EVAL_JUDGE_USER_ID, 'Eval Runner (Judge)')
}

export function collectConsecutiveCaptureEntries(pending: EvalEntry[]): EvalEntry[] {
  const batch: EvalEntry[] = []
  for (const entry of pending) {
    if (entry.kind !== 'capture') break
    batch.push(entry)
  }
  return batch
}

async function tryReuseCorpusCapture(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
  corpusFixtureMap: Map<string, CorpusFixtureRef>
  rawText: string
  fixtureRef: string
  billing: WithEvalDbOptions
}): Promise<{ passed: boolean; result: Record<string, unknown> } | null> {
  const corpusRef = input.corpusFixtureMap.get(input.fixtureRef)
  if (!corpusRef) return null

  const existing = await withEvalDb(
    input.evalUserId,
    async (db) => {
      const [row] = await db
        .select({
          id: thought.id,
          rawText: thought.rawText,
          normalizedText: thought.normalizedText,
          category: thought.category,
        })
        .from(thought)
        .where(and(eq(thought.userId, input.evalUserId), eq(thought.id, corpusRef.thoughtId)))
      return row ?? null
    },
    input.billing,
  )

  if (
    !existing ||
    !shouldReuseCorpusCapture({ expectedRawText: input.rawText, storedRawText: existing.rawText })
  ) {
    return null
  }

  const reuseOk = await withEvalDb(
    input.evalUserId,
    async (db) => {
      const health = await assessCorpusThoughtReuseHealth({
        db,
        evalUserId: input.evalUserId,
        thoughtId: existing.id,
        withEvalDbOptions: input.billing,
      })
      if (!health.reusable) {
        return { reusable: false as const, reason: health.reason ?? 'unhealthy corpus row' }
      }
      try {
        await assertThoughtEntitiesResolved(db, input.evalUserId, [existing.id])
      } catch {
        await reenrichThought(input.evalUserId, existing.id, existing.normalizedText)
        await assertThoughtEntitiesResolved(db, input.evalUserId, [existing.id])
      }
      return { reusable: true as const }
    },
    input.billing,
  )

  if (!reuseOk.reusable) {
    await invalidateCorpusFixture({
      evalUserId: input.evalUserId,
      corpusFixtureMap: input.corpusFixtureMap,
      fixtureId: input.fixtureRef,
    })
    await appendEvalEvent({
      operatorUserId: input.operatorUserId,
      runId: input.runId,
      entryId: input.entry.id,
      level: 'warn',
      message:
        `corpus reuse rejected for ${input.fixtureRef}` +
        ('reason' in reuseOk && reuseOk.reason ? `: ${reuseOk.reason}` : '') +
        ' — re-capturing',
    })
    return null
  }

  await upsertThoughtMap(input.operatorUserId, input.runId, input.fixtureRef, existing.id)
  await appendEvalEvent({
    operatorUserId: input.operatorUserId,
    runId: input.runId,
    entryId: input.entry.id,
    message: `capture reused fixture ${input.fixtureRef} (thought ${existing.id})`,
  })
  return {
    passed: true,
    result: {
      reused: true,
      thoughtId: existing.id,
      rawText: existing.rawText,
      category: existing.category,
      normalizedText: existing.normalizedText,
      sourceRunId: corpusRef.sourceRunId,
      explanation: 'Reused existing corpus capture',
    },
  }
}

async function completeEvalEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  startedAt: Date
  outcome: { passed: boolean; result: Record<string, unknown> }
}): Promise<void> {
  const durationMs = Date.now() - input.startedAt.getTime()
  await updateEvalEntry(input.operatorUserId, input.entry.id, {
    status: 'completed',
    passed: input.outcome.passed,
    resultJson: input.outcome.result,
    durationMs,
    finishedAt: new Date(),
  })
  await appendEvalEvent({
    operatorUserId: input.operatorUserId,
    runId: input.runId,
    entryId: input.entry.id,
    message: `entry done: passed=${input.outcome.passed} (${durationMs}ms)`,
  })
}

async function failEvalEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  startedAt: Date
  error: string
}): Promise<void> {
  await updateEvalEntry(input.operatorUserId, input.entry.id, {
    status: 'failed',
    passed: false,
    error: input.error,
    finishedAt: new Date(),
    durationMs: Date.now() - input.startedAt.getTime(),
  })
  await appendEvalEvent({
    operatorUserId: input.operatorUserId,
    runId: input.runId,
    entryId: input.entry.id,
    level: 'error',
    message: input.error,
  })
}

// Batch capture removed: eval ingest now runs one-by-one to measure usability latency accurately.

async function runCaptureEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
  corpusFixtureMap: Map<string, CorpusFixtureRef>
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
  const rawText = String(input.entry.inputJson.rawText ?? '')
  if (!rawText.trim()) {
    throw new Error('capture entry missing rawText')
  }
  const capturedAtRaw = input.entry.inputJson.createdAt
  const capturedAt =
    typeof capturedAtRaw === 'string' && capturedAtRaw.trim() ? new Date(capturedAtRaw) : undefined
  if (capturedAt && Number.isNaN(capturedAt.getTime())) {
    throw new Error(`capture entry has invalid createdAt: ${capturedAtRaw}`)
  }
  const fixtureRef = input.entry.fixtureRef ?? 'unknown'
  const billing = evalBillingOpts(input.operatorUserId)

  const reused = await tryReuseCorpusCapture({
    operatorUserId: input.operatorUserId,
    runId: input.runId,
    entry: input.entry,
    evalUserId: input.evalUserId,
    corpusFixtureMap: input.corpusFixtureMap,
    rawText,
    fixtureRef,
    billing,
  })
  if (reused) return reused

  const stored = await withEvalDb(
    input.evalUserId,
    () =>
      captureThought(input.evalUserId, rawText, {
        awaitEnrichment: false,
        ...(capturedAt ? { capturedAt } : {}),
        onProgress: async (ev) => {
          const phases = ev.parallel ? ev.phases.join(',') : ev.phase
          await appendEvalEvent({
            operatorUserId: input.operatorUserId,
            runId: input.runId,
            entryId: input.entry.id,
            message: `capture progress: ${phases}`,
          })
        },
      }),
    billing,
  )

  let enrichQueued = true
  await withEvalDb(
    input.evalUserId,
    async (db) => {
      const [enrichRow] = await db
        .select({ enrichedAt: thought.enrichedAt })
        .from(thought)
        .where(and(eq(thought.userId, input.evalUserId), eq(thought.id, stored.id)))
      enrichQueued = !enrichRow?.enrichedAt
      if (enrichQueued) {
        logEval(
          `capture tier-1 stored for ${stored.id}; background enrich queued (verified at check step)`,
        )
      }
    },
    billing,
  )

  const fidelityInput = buildCaptureFidelityJudgeInput(rawText, stored)
  const fidelity = await judgeCaptureFidelity({
    ...fidelityInput,
    billingUserId: input.operatorUserId,
  })

  await upsertThoughtMap(input.operatorUserId, input.runId, fixtureRef, stored.id)
  input.corpusFixtureMap.set(fixtureRef, { thoughtId: stored.id, sourceRunId: input.runId })

  return {
    passed: fidelity.faithful,
    result: {
      thoughtId: stored.id,
      rawText: fidelityInput.rawText,
      category: stored.category,
      normalizedText: stored.normalizedText,
      enrichQueued,
      fidelityScore: fidelity.score,
      fidelityFaithful: fidelity.faithful,
      fidelityRationale: fidelity.rationale,
      explanation: fidelity.rationale,
    },
  }
}

async function runCheckEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
  const checks = input.entry.inputJson.checks as QaChecks | undefined
  if (!checks) {
    throw new Error('check entry missing checks config')
  }

  const fixtureToUuid = await getThoughtMap(input.operatorUserId, input.runId)

  const entityFixtureIds = fixtureIdsRequiringEntityResolution(checks)
  const enrichFixtureIds = fixtureIdsRequiringEnrichment(checks)
  const entityThoughtIds = [
    ...new Set(
      entityFixtureIds
        .map((fixtureId) => fixtureToUuid.get(fixtureId))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const enrichThoughtIds = [
    ...new Set(
      enrichFixtureIds
        .map((fixtureId) => fixtureToUuid.get(fixtureId))
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  const result = await withEvalDb(
    input.evalUserId,
    async (db) => {
      if (entityThoughtIds.length > 0) {
        const targets = await loadThoughtEnrichmentTargets(db, input.evalUserId, entityThoughtIds)
        await waitForThoughtEnrichment({
          db,
          userId: input.evalUserId,
          targets,
          withEvalDbOptions: evalBillingOpts(input.operatorUserId),
        })
        await assertThoughtEntitiesResolved(db, input.evalUserId, entityThoughtIds)
      }
      if (enrichThoughtIds.length > 0) {
        const targets = await loadThoughtEnrichmentTargets(db, input.evalUserId, enrichThoughtIds)
        await waitForThoughtEnrichmentComplete({
          db,
          userId: input.evalUserId,
          targets,
          withEvalDbOptions: evalBillingOpts(input.operatorUserId),
        })
      }
      return runStructuralChecks({
        db,
        userId: input.evalUserId,
        fixtureToUuid,
        checks,
      })
    },
    evalBillingOpts(input.operatorUserId),
  )

  let graphSnapshot: Awaited<ReturnType<typeof captureEvalGraphSnapshot>> | undefined
  try {
    graphSnapshot = await captureEvalGraphSnapshot({
      evalUserId: input.evalUserId,
      fixtureToUuid,
    })
    await appendEvalEvent({
      operatorUserId: input.operatorUserId,
      runId: input.runId,
      entryId: input.entry.id,
      message: `graph snapshot: ${graphSnapshot.nodes.length} nodes, ${graphSnapshot.edges.length} edges`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await appendEvalEvent({
      operatorUserId: input.operatorUserId,
      runId: input.runId,
      entryId: input.entry.id,
      level: 'warn',
      message: `graph snapshot failed: ${message}`,
    })
  }

  const qaId = String(input.entry.inputJson.qaId ?? '').trim()
  const ingestBroken = ingestBrokenFromCheckAssertions(result.assertions)
  const corpusInvalidated = [...ingestBroken]

  const passed = result.failedCount === 0
  return {
    passed,
    result: {
      qaId: input.entry.inputJson.qaId,
      ...(corpusInvalidated.length > 0 ? { corpusInvalidated } : {}),
      ...result,
      ...(graphSnapshot ? { graphSnapshot } : {}),
      explanation: passed
        ? `All ${result.passedCount} structural assertions passed`
        : `${result.failedCount} of ${result.assertions.length} assertions failed`,
    },
  }
}

async function ingestBrokenForQaFromRun(
  operatorUserId: string,
  runId: string,
  qaId: string,
): Promise<Set<string>> {
  const entries = await listEvalEntries(operatorUserId, runId)
  const check = entries.find(
    (e) => e.kind === 'check' && e.fixtureRef === `${qaId}_check` && e.status === 'completed',
  )
  const raw = check?.resultJson as { assertions?: CheckAssertionResult[] } | null | undefined
  if (!raw?.assertions?.length) return new Set()
  return ingestBrokenFromCheckAssertions(raw.assertions)
}

async function runRetrievalEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
  const queryText = String(input.entry.inputJson.query ?? '')
  const relevant = input.entry.expectedJson.relevant as EvalRetrievalQuery['relevant'] | undefined
  if (!queryText || !relevant) {
    throw new Error('retrieval entry missing query or expected relevant grades')
  }

  const fixtureToUuid = await getThoughtMap(input.operatorUserId, input.runId)
  const qaId = qaIdFromRetrievalFixtureRef(input.entry.fixtureRef)
  const ingestBroken = qaId
    ? await ingestBrokenForQaFromRun(input.operatorUserId, input.runId, qaId)
    : new Set<string>()

  let needleFixtureIdFromExpected =
    typeof input.entry.expectedJson.needleFixtureId === 'string'
      ? input.entry.expectedJson.needleFixtureId
      : undefined

  const {
    scoped: scopedRelevant,
    skippedUncaptured,
    skippedIngestBroken,
    ingestBrokenNeedleRetained,
  } = runtimeRetrievalRelevant({
    relevant,
    fixtureToUuid,
    ingestBroken,
    needleFixtureId: needleFixtureIdFromExpected,
  })

  if (scopedRelevant.length === 0) {
    const parts = [
      skippedIngestBroken.length > 0
        ? `ingest-broken haystack (excluded from retrieval grades): ${skippedIngestBroken.join(', ')}`
        : null,
      skippedUncaptured.length > 0 ? `uncaptured: ${skippedUncaptured.join(', ')}` : null,
    ].filter(Boolean)
    throw new Error(
      `retrieval: no gradable relevance labels remain${parts.length ? ` (${parts.join('; ')})` : ''}`,
    )
  }

  const skipParts: string[] = []
  if (skippedUncaptured.length > 0) {
    skipParts.push(`uncaptured labels: ${skippedUncaptured.join(', ')}`)
  }
  if (skippedIngestBroken.length > 0) {
    skipParts.push(
      `ingest-broken haystack (excluded from retrieval grades): ${skippedIngestBroken.join(', ')}`,
    )
  }
  if (ingestBrokenNeedleRetained.length > 0) {
    skipParts.push(
      `needle ingest failed but still graded: ${ingestBrokenNeedleRetained.join(', ')} — fix check assertions`,
    )
  }
  if (skipParts.length > 0) {
    await appendEvalEvent({
      operatorUserId: input.operatorUserId,
      runId: input.runId,
      entryId: input.entry.id,
      message: `grading against ${scopedRelevant.length} fixture(s); skipped ${skipParts.join('; ')}`,
    })
  }

  const query: EvalRetrievalQuery = {
    id: input.entry.fixtureRef ?? 'custom',
    category: (input.entry.inputJson.category as EvalRetrievalQuery['category']) ?? 'hybrid',
    text: queryText,
    relevant: scopedRelevant,
  }

  const minNdcgAt10 =
    typeof input.entry.expectedJson.minNdcgAt10 === 'number'
      ? input.entry.expectedJson.minNdcgAt10
      : 0.5
  let needleFixtureId = needleFixtureIdFromExpected
  const needleTopK =
    typeof input.entry.expectedJson.needleTopK === 'number'
      ? input.entry.expectedJson.needleTopK
      : 5

  const sweep = await runRetrievalSweepForQuery({
    evalUserId: input.evalUserId,
    billingUserId: input.operatorUserId,
    query,
    fixtureToUuid,
    minNdcgAt10,
    onProgress: (msg) =>
      void appendEvalEvent({
        operatorUserId: input.operatorUserId,
        runId: input.runId,
        entryId: input.entry.id,
        message: msg,
      }),
  })

  const bestSweepRow = sweep.weightSweep.find(
    (w) =>
      w.weights.vector === sweep.bestWeights.vector && w.weights.graph === sweep.bestWeights.graph,
  )

  const topRanked = bestSweepRow?.ranked ?? []
  let passed = sweep.passed
  const extraChecks: string[] = []

  if (needleFixtureId) {
    const needleInTopK = topRanked.slice(0, needleTopK).includes(needleFixtureId)
    if (!needleInTopK) passed = false
    extraChecks.push(
      needleInTopK
        ? `needle ${needleFixtureId} in top-${needleTopK}`
        : `needle ${needleFixtureId} NOT in top-${needleTopK} (ranked: ${topRanked.slice(0, needleTopK).join(', ')})`,
    )
  }

  const requireSalienceBump = input.entry.expectedJson.requireSalienceBump === true
  const minAccessCount =
    typeof input.entry.expectedJson.minAccessCount === 'number'
      ? input.entry.expectedJson.minAccessCount
      : undefined
  if (requireSalienceBump || minAccessCount != null) {
    const rankedUuids = topRanked
      .map((fid) => fixtureToUuid.get(fid))
      .filter((id): id is string => Boolean(id))
    if (rankedUuids.length > 0) {
      const rows = await withEvalDb(
        input.evalUserId,
        (db) =>
          db
            .select({ id: thought.id, accessCount: thought.accessCount })
            .from(thought)
            .where(and(eq(thought.userId, input.evalUserId), inArray(thought.id, rankedUuids))),
        evalBillingOpts(input.operatorUserId),
      )
      const minSeen = rows.length > 0 ? Math.min(...rows.map((r) => r.accessCount)) : 0
      if (requireSalienceBump && minSeen < 1) {
        passed = false
        extraChecks.push(`access_count bump missing (min=${minSeen})`)
      } else if (minAccessCount != null && minSeen < minAccessCount) {
        passed = false
        extraChecks.push(`access_count min ${minAccessCount} not met (min=${minSeen})`)
      } else {
        extraChecks.push(`access_count ok (min=${minSeen})`)
      }
    }
  }

  return {
    passed,
    result: {
      ...sweep,
      query: queryText,
      topRanked,
      scopedRelevant,
      skippedUncaptured,
      skippedIngestBroken,
      ingestBrokenNeedleRetained,
      needleCheck: needleFixtureId
        ? {
            fixtureId: needleFixtureId,
            topK: needleTopK,
            inTopK: topRanked.slice(0, needleTopK).includes(needleFixtureId),
          }
        : undefined,
      extraChecks,
      explanation: [
        `Best NDCG@10=${sweep.bestNdcgAt10.toFixed(3)} (threshold=${minNdcgAt10})`,
        ...extraChecks,
      ].join('; '),
    },
  }
}

async function runEditEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
  const fixtureId = String(input.entry.inputJson.fixtureId ?? '')
  const newRawText = String(input.entry.inputJson.newRawText ?? '')
  if (!fixtureId.trim() || !newRawText.trim()) {
    throw new Error('edit entry missing fixtureId or newRawText')
  }

  const fixtureToUuid = await getThoughtMap(input.operatorUserId, input.runId)
  const thoughtId = fixtureToUuid.get(fixtureId)
  if (!thoughtId) {
    throw new Error(`edit: no captured thought for fixture ${fixtureId}`)
  }

  const editResult = await withEvalDb(
    input.evalUserId,
    () =>
      editStoredThought(input.evalUserId, thoughtId, newRawText, {
        onProgress: async (ev) => {
          const phases = ev.parallel ? ev.phases.join(',') : ev.phase
          await appendEvalEvent({
            operatorUserId: input.operatorUserId,
            runId: input.runId,
            entryId: input.entry.id,
            message: `edit progress: ${phases}`,
          })
        },
      }),
    evalBillingOpts(input.operatorUserId),
  )
  if (!editResult.ok) {
    throw new Error(`edit failed: ${editResult.reason}`)
  }
  const stored = editResult.thought

  await withEvalDb(
    input.evalUserId,
    async (db) => {
      await assertThoughtEntitiesResolved(db, input.evalUserId, [thoughtId])
    },
    evalBillingOpts(input.operatorUserId),
  )

  const passed = storedTextReflectsEdit(stored.normalizedText, newRawText)

  return {
    passed,
    result: {
      fixtureId,
      thoughtId: stored.id,
      newRawText,
      normalizedText: stored.normalizedText,
      explanation: passed
        ? 'Stored text reflects edit request'
        : 'Stored text may not fully reflect edit request',
    },
  }
}

async function runAnswerEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
}): Promise<{ passed: boolean; result: Record<string, unknown> }> {
  const question = String(input.entry.inputJson.question ?? '')
  const acceptance = String(input.entry.expectedJson.acceptance ?? '')
  const retrievalQuery =
    typeof input.entry.inputJson.retrievalQuery === 'string'
      ? input.entry.inputJson.retrievalQuery.trim()
      : ''
  if (!question || !acceptance) {
    throw new Error('answer entry missing question or acceptance criteria')
  }

  const composed = await withEvalDb(
    input.evalUserId,
    () =>
      composeAnswer({
        userId: input.evalUserId,
        question,
        ...(retrievalQuery ? { retrievalQuery } : {}),
      }),
    evalBillingOpts(input.operatorUserId),
  )

  const verdict = await judgeAnswerAcceptance({
    question,
    answer: composed.answer,
    acceptance,
    citations: composed.citations,
    billingUserId: input.operatorUserId,
  })

  return {
    passed: verdict.passed,
    result: {
      question,
      acceptance,
      answer: composed.answer,
      citations: composed.citations,
      retrieved: composed.retrieved.map((r) => ({
        id: r.id,
        normalizedText: r.normalizedText,
        category: r.category,
      })),
      verdictScore: verdict.score,
      verdictPassed: verdict.passed,
      explanation: verdict.explanation,
    },
  }
}

async function runOneEntry(input: {
  operatorUserId: string
  runId: string
  entry: EvalEntry
  evalUserId: string
  corpusFixtureMap: Map<string, CorpusFixtureRef>
}): Promise<void> {
  const startedAt = new Date()
  await updateEvalEntry(input.operatorUserId, input.entry.id, {
    status: 'running',
    startedAt,
  })
  await appendEvalEvent({
    operatorUserId: input.operatorUserId,
    runId: input.runId,
    entryId: input.entry.id,
    message: `entry start: ${input.entry.kind} ${input.entry.fixtureRef ?? ''}`,
  })

  const entryLabel = `${input.entry.kind} ${input.entry.fixtureRef ?? ''}`.trim()
  const timeoutMs = resolveEntryTimeoutMs(input.entry.kind)

  try {
    let outcome: { passed: boolean; result: Record<string, unknown> }
    outcome = await withEvalEntryTimeout(timeoutMs, entryLabel, async () => {
      if (input.entry.kind === 'capture') {
        return runCaptureEntry(input)
      }
      if (input.entry.kind === 'check') {
        return runCheckEntry(input)
      }
      if (input.entry.kind === 'retrieval') {
        return runRetrievalEntry(input)
      }
      if (input.entry.kind === 'edit') {
        return runEditEntry(input)
      }
      if (input.entry.kind === 'answer') {
        return runAnswerEntry(input)
      }
      throw new Error(`unknown entry kind: ${input.entry.kind}`)
    })

    const durationMs = Date.now() - startedAt.getTime()
    await updateEvalEntry(input.operatorUserId, input.entry.id, {
      status: 'completed',
      passed: outcome.passed,
      resultJson: outcome.result,
      durationMs,
      finishedAt: new Date(),
    })
    await appendEvalEvent({
      operatorUserId: input.operatorUserId,
      runId: input.runId,
      entryId: input.entry.id,
      message: `entry done: passed=${outcome.passed} (${durationMs}ms)`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await updateEvalEntry(input.operatorUserId, input.entry.id, {
      status: 'failed',
      passed: false,
      error: message,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    })
    await appendEvalEvent({
      operatorUserId: input.operatorUserId,
      runId: input.runId,
      entryId: input.entry.id,
      level: 'error',
      message,
    })
  }
}

function entrySummaries(entries: EvalEntry[]): EntrySummary[] {
  return entries.map((e) => {
    const result = e.resultJson as Record<string, unknown> | null
    let summary = `${e.kind} ${e.fixtureRef ?? ''}: ${e.status}`
    if (e.passed === true) summary += ' PASS'
    if (e.passed === false) summary += ' FAIL'
    if (result?.explanation) summary += ` — ${String(result.explanation)}`
    if (result?.bestNdcgAt10 != null) summary += ` ndcg=${Number(result.bestNdcgAt10).toFixed(3)}`
    return {
      kind: e.kind,
      fixtureRef: e.fixtureRef,
      passed: e.passed,
      summary,
    }
  })
}

export async function executeEvalRun(input: {
  operatorUserId: string
  runId: string
  freshCorpus?: boolean
  scenarioGoal?: string
}): Promise<EvalSynthesis | null> {
  const run = await getEvalRunRow(input.operatorUserId, input.runId)
  if (!run) throw new Error(`eval run not found: ${input.runId}`)

  const config = (run.configJson ?? {}) as Record<string, unknown>
  const freshCorpus = input.freshCorpus ?? config.freshCorpus === true

  await ensureJudgeUser()

  if (freshCorpus) {
    try {
      await deleteEvalUserRow(run.evalUserId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logEval(`fresh corpus delete warning: ${msg}`)
    }
  }

  await insertEvalUserRow(run.evalUserId, 'Eval corpus')

  await updateEvalRunStatus(input.operatorUserId, input.runId, {
    status: 'running',
    startedAt: new Date(),
    error: null,
  })
  await appendEvalEvent({
    operatorUserId: input.operatorUserId,
    runId: input.runId,
    message:
      `run start: evalUserId=${run.evalUserId}` +
      (freshCorpus ? ' (fresh corpus)' : ' (persistent corpus)'),
  })

  let synthesis: EvalSynthesis | null = null
  let runError: string | null = null

  try {
    await runWithTrace(input.runId, async () => {
      const corpusFixtureMap = freshCorpus
        ? new Map<string, CorpusFixtureRef>()
        : await getCorpusFixtureMap(input.operatorUserId, run.evalUserId)

      const maxIngestRetries = resolveIngestRetryMax()
      let ingestRetryPass = 0

      while (true) {
        assertEvalRunNotStopped(input.runId)
        let entries = await listEvalEntries(input.operatorUserId, input.runId)
        const total = entries.length

        for (;;) {
          assertEvalRunNotStopped(input.runId)
          const pending = entries.filter((e) => e.status !== 'completed' && e.status !== 'failed')
          if (pending.length === 0) break

          const wave = collectNextWave(pending)
          const waveLabel =
            wave.length === 1
              ? `step ${wave[0]!.ordinal + 1}/${total}: ${wave[0]!.kind} ${wave[0]!.fixtureRef ?? ''}`
              : `wave ${wave[0]!.ordinal + 1}-${wave[wave.length - 1]!.ordinal + 1}/${total}: ` +
                `${wave.length}× ${String(wave[0]!.inputJson?.parallelWave ?? wave[0]!.kind)}`

          await appendEvalEvent({
            operatorUserId: input.operatorUserId,
            runId: input.runId,
            entryId: wave.length === 1 ? wave[0]!.id : undefined,
            message: waveLabel,
          })

          const waveId = wave[0]!.inputJson?.parallelWave
          const entryConcurrency =
            typeof waveId === 'string' && waveId.trim() ? resolveEvalEntryConcurrency() : 1
          await mapWithConcurrency(wave, entryConcurrency, async (entry) => {
            await appendEvalEvent({
              operatorUserId: input.operatorUserId,
              runId: input.runId,
              entryId: entry.id,
              message: `entry start: ${entry.kind} ${entry.fixtureRef ?? ''}`,
            })
            await runOneEntry({
              operatorUserId: input.operatorUserId,
              runId: input.runId,
              entry,
              evalUserId: run.evalUserId,
              corpusFixtureMap,
            })
          })
          entries = await listEvalEntries(input.operatorUserId, input.runId)
        }

        const passEntries = await listEvalEntries(input.operatorUserId, input.runId)
        const retryBatches = planIngestRetries(passEntries)
        const brokenFixtures = allBrokenFixtureIds(retryBatches)

        if (brokenFixtures.length > 0) {
          const purged = await purgeCorpusFixtures({
            evalUserId: run.evalUserId,
            corpusFixtureMap,
            fixtureIds: brokenFixtures,
          })
          for (const fixtureId of purged) {
            await appendEvalEvent({
              operatorUserId: input.operatorUserId,
              runId: input.runId,
              message: `corpus invalidated: ${fixtureId} (ingest broken — will re-capture on retry)`,
            })
          }
        }

        if (retryBatches.length === 0 || ingestRetryPass >= maxIngestRetries) {
          break
        }

        const entryIds = [
          ...new Set(retryBatches.flatMap((batch) => batch.entriesToRerun.map((e) => e.id))),
        ]
        await resetEvalEntriesForRetry(input.operatorUserId, entryIds)
        ingestRetryPass += 1
        await appendEvalEvent({
          operatorUserId: input.operatorUserId,
          runId: input.runId,
          message:
            `ingest retry ${ingestRetryPass}/${maxIngestRetries}: re-running ${entryIds.length} ` +
            `entr${entryIds.length === 1 ? 'y' : 'ies'} for fixture(s) ${brokenFixtures.join(', ')}`,
        })
      }

      const finalEntries = await listEvalEntries(input.operatorUserId, input.runId)
      synthesis = await generateRunSynthesis({
        runLabel: run.label,
        scenarioGoal: input.scenarioGoal,
        entries: entrySummaries(finalEntries),
        billingUserId: input.operatorUserId,
      })
      await updateEvalRunStatus(input.operatorUserId, input.runId, {
        synthesisJson: synthesis,
      })
    })
  } catch (err) {
    if (err instanceof EvalRunStoppedError) {
      runError = 'Stopped by operator'
      await appendEvalEvent({
        operatorUserId: input.operatorUserId,
        runId: input.runId,
        level: 'warn',
        message: runError,
      })
    } else {
      runError = err instanceof Error ? err.message : String(err)
      await appendEvalEvent({
        operatorUserId: input.operatorUserId,
        runId: input.runId,
        level: 'error',
        message: runError,
      })
    }
  } finally {
    const stopped = isEvalRunStopRequested(input.runId)
    const finalEntries = await listEvalEntries(input.operatorUserId, input.runId)

    if (stopped) {
      for (const entry of finalEntries) {
        if (entry.status === 'pending' || entry.status === 'running') {
          await updateEvalEntry(input.operatorUserId, entry.id, {
            status: 'failed',
            passed: false,
            error: 'Run stopped by operator',
            finishedAt: new Date(),
          })
        }
      }
    }

    const entriesForScore = await listEvalEntries(input.operatorUserId, input.runId)
    const entrySummariesForScore: EvalEntrySummary[] = entriesForScore.map((e) => ({
      id: e.id,
      ordinal: e.ordinal,
      kind: e.kind,
      fixtureRef: e.fixtureRef,
      status: e.status,
      passed: e.passed,
      durationMs: e.durationMs,
      error: e.error,
      input: e.inputJson as Record<string, unknown>,
      expected: e.expectedJson as Record<string, unknown>,
      result: (e.resultJson as Record<string, unknown> | null) ?? null,
    }))
    const runScore = aggregateRunScores(entrySummariesForScore)
    const scoringPass = isRunScorePassing(runScore)

    await updateEvalRunStatus(input.operatorUserId, input.runId, {
      status: stopped ? 'stopped' : runError || !scoringPass ? 'failed' : 'completed',
      finishedAt: new Date(),
      error: stopped ? 'Stopped by operator' : runError,
    })
  }

  return synthesis
}
