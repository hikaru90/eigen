import './load-project-env'

/**
 * Small live benchmark: run N captures through the REAL ingest pipeline
 * (captureThought with inline enrichment) while the Jev decision-model shadow
 * fires beside the authoritative chat judge. Aggregates agreement, latency and
 * cost per engine from decision_shadow_log + activity_call_log.
 *
 * Spec: docs/planning/09-jev-decision-plane.md — shadow never alters the
 * pipeline; this script only reads the diagnostic rows it produces.
 *
 * Usage:
 *   npm run measure:jev
 *
 * Optional env:
 *   MEASURE_JEV_TEXTS — pipe-separated custom capture texts
 *   MEASURE_JEV_USER_ID — tenant user (default: eval corpus of the operator)
 *   MEASURE_JEV_BILLING_USER_ID — credits debited from (default: eval operator)
 */
import { and, gte, sql } from 'drizzle-orm'
import { insertEvalUserRow } from '$lib/eval/store'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { creditFromPayment, getOrCreateWallet } from '$lib/server/billing/wallet'
import { createIngestPhaseTimer } from '$lib/server/capture/phase-timing'
import { captureThought } from '$lib/server/capture/service'
import { activityCallLog, decisionShadowLog, paymentOrder } from '$lib/server/db/schema'
import { resolveDecisionShadowConfig } from '$lib/server/llm/decision-client'
import { EVAL_OPERATOR_USER_ID, evalCorpusUserId } from '../evals/harness/eval-config'
import { runEval, withEvalDb } from '../evals/harness/eval-context'

const DEFAULT_TEXTS = [
  // task
  'Renew my passport before the Japan trip in March — book the appointment this week.',
  // idea / concept
  'Idea: route the bounded classification questions in eigen to a small decision model and keep text generation on the big chat model.',
  // reference material (content_role split probe)
  'Mediterranean pasta: sauté three cloves of garlic in olive oil, add cherry tomatoes and kalamata olives, toss with 400g of linguine and finish with feta and basil.',
  // person + event
  'Lunch with Marta on Friday to plan the wedding toast — she wants to rehearse at her place in Kreuzberg.',
  // task / meeting
  'Weekly team sync agenda: review the decision-plane shadow metrics, triage the enrich queue, and plan the retrieval latency benchmark.',
  // observation / health
  'Felt great after the morning run along the canal — 8k without stopping, keeping the streak alive.',
]

function loadTexts(): string[] {
  const raw = process.env.MEASURE_JEV_TEXTS?.trim()
  if (!raw) return DEFAULT_TEXTS
  const texts = raw
    .split('|')
    .map((t) => t.trim())
    .filter(Boolean)
  if (texts.length === 0) throw new Error('MEASURE_JEV_TEXTS is set but empty after splitting on "|"')
  return texts
}

async function ensureOperatorCredits(operatorUserId: string): Promise<void> {
  await insertEvalUserRow(operatorUserId, 'Jev Benchmark Operator')

  let wallet = await withEvalDb(operatorUserId, () => getOrCreateWallet(operatorUserId))
  if (wallet.availableCredits < MIN_CAPTURE_PIPELINE_CREDITS) {
    const paypalOrderId = `measure_jev_${Date.now()}`
    await withEvalDb(operatorUserId, async (db) => {
      const [row] = await db
        .insert(paymentOrder)
        .values({
          userId: operatorUserId,
          paypalOrderId,
          status: 'created',
          requestedCredits: 50_000,
          currency: 'USD',
        })
        .returning({ id: paymentOrder.id })
      await creditFromPayment({
        userId: operatorUserId,
        paymentOrderId: row.id,
        paypalOrderId,
        amountCredits: 50_000,
      })
    })
    wallet = await withEvalDb(operatorUserId, () => getOrCreateWallet(operatorUserId))
  }
  console.info('[jev-bench] operator wallet', { availableCredits: wallet.availableCredits })
}

type CaptureOutcome = { ok: true; elapsedMs: number; category: string; phases: Array<{ phase: string; ms: number }> } | { ok: false; elapsedMs: number; error: string }

async function main(): Promise<void> {
  const billingUserId = process.env.MEASURE_JEV_BILLING_USER_ID?.trim() || EVAL_OPERATOR_USER_ID
  const tenantUserId = process.env.MEASURE_JEV_USER_ID?.trim() || evalCorpusUserId(billingUserId)
  const texts = loadTexts()

  const shadowConfig = resolveDecisionShadowConfig()
  if (!shadowConfig) {
    console.warn('[jev-bench] DECISION_SHADOW is DISABLED — the run still exercises the normal pipeline, but no Jev rows will be produced.')
  } else {
    console.info('[jev-bench] decision shadow enabled', { model: shadowConfig.model })
  }

  await ensureOperatorCredits(billingUserId)
  await insertEvalUserRow(tenantUserId, 'Jev benchmark corpus')

  // Scope all aggregation to rows created during THIS run.
  const startedAt = new Date()
  console.info('[jev-bench] start', { captures: texts.length, tenantUserId })

  const outcomes: CaptureOutcome[] = []
  for (const [i, rawText] of texts.entries()) {
    const ingestTimer = createIngestPhaseTimer()
    const captureStart = Date.now()
    try {
      const result = await withEvalDb(
        tenantUserId,
        () => captureThought(tenantUserId, rawText, { ingestTimer, awaitEnrichment: true }),
        { billingUserId },
      )
      const elapsedMs = Date.now() - captureStart
      const phases = [...ingestTimer.finish().phases].sort((a, b) => b.ms - a.ms)
      outcomes.push({ ok: true, elapsedMs, category: result.category, phases })
      console.info(
        `[jev-bench] capture ${i + 1}/${texts.length} ok`, {
          category: result.category,
          entityCount: result.entities.length,
          enrichmentComplete: result.enrichmentComplete,
          elapsedMs,
          topPhase: phases[0] ? `${phases[0].phase} ${phases[0].ms}ms` : 'n/a',
        },
      )
    } catch (err) {
      const elapsedMs = Date.now() - captureStart
      const error = err instanceof Error ? err.message : String(err)
      outcomes.push({ ok: false, elapsedMs, error })
      console.error(`[jev-bench] capture ${i + 1}/${texts.length} FAILED after ${elapsedMs}ms`, error)
    }
  }

  const runElapsedMs = Date.now() - startedAt
  const okOutcomes = outcomes.filter((o): o is Extract<CaptureOutcome, { ok: true }> => o.ok)
  const failed = outcomes.length - okOutcomes.length

  // ---- Aggregation: Jev shadow rows created during the run ----
  const shadowKinds = await withEvalDb(tenantUserId, (db) =>
    db
      .select({
        decisionKind: decisionShadowLog.decisionKind,
        total: sql<number>`count(*)::int`,
        agreed: sql<number>`count(*) filter (where ${decisionShadowLog.agree} is true)::int`,
        disagreed: sql<number>`count(*) filter (where ${decisionShadowLog.agree} is false)::int`,
        errored: sql<number>`count(*) filter (where ${decisionShadowLog.decisionError} is not null)::int`,
        avgMs: sql<number>`coalesce(round(avg(${decisionShadowLog.decisionDurationMs})), 0)::int`,
        avgProbability: sql<number>`coalesce(round(avg(${decisionShadowLog.decisionProbability})::numeric, 3), 0)::float8`,
        authoritativeEngine: sql<string>`(array_agg(${decisionShadowLog.authoritativeEngine} order by ${decisionShadowLog.createdAt} desc))[1]`,
      })
      .from(decisionShadowLog)
      .where(and(gte(decisionShadowLog.createdAt, startedAt), sql`${decisionShadowLog.userId} = ${tenantUserId}`))
      .groupBy(decisionShadowLog.decisionKind),
  )

  // ---- Aggregation: gateway calls created during the run ----
  const callGroups = await withEvalDb(tenantUserId, (db) =>
    db
      .select({
        operation: sql<string>`split_part(${activityCallLog.operation}, ' (attempt', 1)`,
        calls: sql<number>`count(*)::int`,
        avgMs: sql<number>`coalesce(round(avg(${activityCallLog.durationMs})), 0)::int`,
        maxMs: sql<number>`coalesce(round(max(${activityCallLog.durationMs})), 0)::int`,
        baseCostUsd: sql<number>`coalesce(sum(${activityCallLog.baseCostUsd}::double precision), 0)::float8`,
        totalCostUsd: sql<number>`coalesce(sum(${activityCallLog.totalCostUsd}::double precision), 0)::float8`,
      })
      .from(activityCallLog)
      .where(and(gte(activityCallLog.createdAt, startedAt), sql`${activityCallLog.userId} = ${tenantUserId}`))
      .groupBy(sql`split_part(${activityCallLog.operation}, ' (attempt', 1)`)
      .orderBy(sql`count(*) desc`),
  )

  const chat = callGroups.filter((g) => g.operation.startsWith('llm.chat'))
  const embedding = callGroups.filter((g) => g.operation.startsWith('llm.embedding'))
  const jev = callGroups.filter((g) => g.operation === 'decision_shadow')
  const sum = (groups: typeof callGroups, key: 'baseCostUsd' | 'totalCostUsd') =>
    groups.reduce((acc, g) => acc + g[key], 0)
  const weightedAvgMs = (groups: typeof callGroups) => {
    const calls = groups.reduce((acc, g) => acc + g.calls, 0)
    if (calls === 0) return 0
    return Math.round(groups.reduce((acc, g) => acc + g.avgMs * g.calls, 0) / calls)
  }

  const fmtUsd = (usd: number) => `$${usd.toFixed(7)}`
  const fmtEngine = (label: string, groups: typeof callGroups) => {
    const calls = groups.reduce((acc, g) => acc + g.calls, 0)
    console.info(
      `  ${label.padEnd(28)} ${String(calls).padStart(4)} calls  avg ${String(weightedAvgMs(groups)).padStart(6)} ms  base ${fmtUsd(sum(groups, 'baseCostUsd'))}  with markup ${fmtUsd(sum(groups, 'totalCostUsd'))}`,
    )
  }

  console.info('\n[jev-bench] =========== RUN SUMMARY ===========')
  console.info(`[jev-bench] captures: ${okOutcomes.length} ok, ${failed} failed, wall ${Math.round(runElapsedMs / 100) / 10}s`)
  if (okOutcomes.length > 0) {
    const avgCaptureMs = Math.round(okOutcomes.reduce((a, o) => a + o.elapsedMs, 0) / okOutcomes.length)
    console.info(`[jev-bench] avg capture (persist + full enrich): ${avgCaptureMs} ms`)
    const phaseTotals = new Map<string, number>()
    for (const o of okOutcomes) {
      for (const p of o.phases) phaseTotals.set(p.phase, (phaseTotals.get(p.phase) ?? 0) + p.ms)
    }
    const topPhases = [...phaseTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    console.info(
      '[jev-bench] slowest phases (total over run):',
      topPhases.map(([phase, ms]) => `${phase} ${ms}ms`).join(', '),
    )
  }

  console.info('\n[jev-bench] engine comparison (this run, tenant-scoped):')
  fmtEngine('chat judge (llm.chat)', chat)
  fmtEngine('embedding (llm.embedding)', embedding)
  fmtEngine('jev shadow (decision_shadow)', jev)
  const chatBase = sum(chat, 'baseCostUsd')
  const jevBase = sum(jev, 'baseCostUsd')
  if (jevBase > 0 && chatBase > 0) {
    console.info(`  jev cost = ${((jevBase / chatBase) * 100).toFixed(1)}% of chat-judge cost this run`)
  }

  console.info('\n[jev-bench] decision shadow per kind (this run):')
  if (shadowKinds.length === 0) {
    console.info('  (no shadow rows — is DECISION_SHADOW_ENABLED=true?)')
  }
  for (const k of shadowKinds) {
    const compared = k.agreed + k.disagreed
    const rate = compared > 0 ? `${((k.agreed / compared) * 100).toFixed(0)}%` : 'n/a'
    const authority = k.authoritativeEngine === 'decision_model' ? 'JEV DECIDES' : 'shadow'
    console.info(
      `  ${k.decisionKind.padEnd(14)} [${authority.padEnd(11)}] compared ${String(compared).padStart(3)}  agree ${String(k.agreed).padStart(3)} (${rate})  errored ${String(k.errored).padStart(2)}  avg ${k.avgMs} ms  avg top-prob ${k.avgProbability}`,
    )
  }
  console.info(
    '\n[jev-bench] note: the shadow runs in parallel — it adds no wall time today. The avg ms column is what a PROMOTED jev decision would cost in latency for those bounded choices.',
  )
}

await runEval(main)
