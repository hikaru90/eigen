import './load-project-env'

/**
 * Run one real captureThought and print per-phase ingest timings.
 *
 * Usage:
 *   npx vite-node --config evals/vite.config.ts scripts/measure-ingest-timing.ts
 *
 * Optional env:
 *   MEASURE_INGEST_USER_ID — tenant user (default: eval-corpus-eval-runner-operator)
 *   MEASURE_INGEST_BILLING_USER_ID — credits debited from (default: eval-runner-operator)
 *   MEASURE_INGEST_TEXT — raw thought text
 */
import { insertEvalUserRow } from '$lib/eval/store'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { creditFromPayment, getOrCreateWallet } from '$lib/server/billing/wallet'
import { createIngestPhaseTimer } from '$lib/server/capture/phase-timing'
import { captureThought } from '$lib/server/capture/service'
import { paymentOrder } from '$lib/server/db/schema'
import { EVAL_OPERATOR_USER_ID, evalCorpusUserId } from '../evals/harness/eval-config'
import { runEval, withEvalDb } from '../evals/harness/eval-context'

const DEFAULT_TEXT =
  'Met with Sarah at the coffee shop yesterday. She wants a follow-up next Wednesday before the Berlin trip deadline.'

async function ensureOperatorCredits(operatorUserId: string): Promise<void> {
  await insertEvalUserRow(operatorUserId, 'Ingest Timing Operator')

  let wallet = await withEvalDb(operatorUserId, () => getOrCreateWallet(operatorUserId))
  if (wallet.availableCredits < MIN_CAPTURE_PIPELINE_CREDITS) {
    const paypalOrderId = `measure_ingest_${Date.now()}`
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
  console.info('[measure-ingest] operator wallet', { availableCredits: wallet.availableCredits })
}

async function main(): Promise<void> {
  const billingUserId = process.env.MEASURE_INGEST_BILLING_USER_ID?.trim() || EVAL_OPERATOR_USER_ID
  const tenantUserId = process.env.MEASURE_INGEST_USER_ID?.trim() || evalCorpusUserId(billingUserId)
  const rawText = process.env.MEASURE_INGEST_TEXT?.trim() || DEFAULT_TEXT

  await ensureOperatorCredits(billingUserId)
  await insertEvalUserRow(tenantUserId, 'Ingest timing corpus')

  const ingestTimer = createIngestPhaseTimer()
  const startedAt = Date.now()

  const awaitEnrichment = process.env.MEASURE_INGEST_AWAIT_ENRICHMENT?.trim() === 'true'

  const result = await withEvalDb(
    tenantUserId,
    () =>
      captureThought(tenantUserId, rawText, {
        ingestTimer,
        awaitEnrichment,
      }),
    { billingUserId },
  )

  const timing = ingestTimer.finish()
  const sorted = [...timing.phases].sort((a, b) => b.ms - a.ms)

  console.info('[measure-ingest] result', {
    thoughtId: result.id,
    category: result.category,
    memoryType: result.memoryType,
    entityCount: result.entities.length,
    temporalCount: result.temporalEvents.length,
    linkedThoughtCount: result.linkedThoughts.length,
    enrichmentComplete: result.enrichmentComplete,
    elapsedMs: Date.now() - startedAt,
    wallMs: timing.wallMs,
    phaseSumMs: timing.phases.reduce((sum, p) => sum + p.ms, 0),
  })

  console.info('[measure-ingest] phases (slowest first)')
  for (const entry of sorted) {
    console.info(`  ${entry.phase.padEnd(24)} ${String(entry.ms).padStart(6)} ms`)
  }
}

await runEval(main)
