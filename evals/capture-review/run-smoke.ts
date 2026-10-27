/**
 * `npm run capture-review:smoke` (docs/planning/capture-feedback.md, C1): the live runner. Captures
 * the fixture one by one into the harness tenant `capture-review-smoke` the way the public-bench
 * ingest does (queueCapture + enrichment drain, harness billing wallet, `withEvalDb`, eval clock =
 * the capture time), drains the tenant's job queue so the capture_review_audit jobs run (the global
 * ticker skips harness tenants), then reads every review back and prints the report.
 *
 * Live only (database, embeddings, chat model, Jev): the pure parts are in fixture.ts, cli.ts and
 * report.ts and are unit-tested; this file has no test and is run by the operator.
 */

import type { SmokeArgs } from './cli'
import { eq } from 'drizzle-orm'
import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store'
import {
  CAPTURE_REVIEW_SMOKE_TENANT_ID,
  PUBLIC_BENCH_OPERATOR_USER_ID,
  resolveHarnessBillingUserId,
} from '$lib/server/auth/harness-billing'
import { PLATFORM_CHAT_MODEL } from '$lib/server/billing/platform-llm'
import { loadCaptureAuditInput } from '$lib/server/capture-review/audit-input'
import { CAPTURE_REVIEW_AUDIT_JOB } from '$lib/server/capture-review/job'
import { parseCaptureReviewParts } from '$lib/server/capture-review/review-parts'
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import type { AppDatabase } from '$lib/server/db'
import { captureReview, thought } from '$lib/server/db/schema'
import { drainUserJobQueue } from '$lib/server/job-queue/drain'
import { hasActiveJobForUser } from '$lib/server/job-queue/enqueue'
import {
  resolveDecisionEnforceKinds,
  resolveDecisionShadowConfig,
} from '$lib/server/llm/decision-client'
import { logEval, withEvalDb } from '../harness/eval-context'
import { splitFromOf } from '../personamem/evidence-items'
import { ensurePublicBenchOperator } from '../public-bench/ensure-operator'
import { SMOKE_FIXTURE_PATH, loadSmokeFixture } from './fixture'
import {
  formatSmokeReport,
  orderSplitChildren,
  smokeExitCode,
  type SmokeAuditView,
  type SmokeCaptureResult,
  type SmokeReviewRow,
  type SmokeThoughtResult,
} from './report'

const TENANT = CAPTURE_REVIEW_SMOKE_TENANT_ID
const TENANT_NAME = 'Capture review smoke tenant'

/** How long to keep draining the tenant's job queue for one capture (retries back off 1s, 2s, 4s). */
const AUDIT_DRAIN_TIMEOUT_MS = 180_000
const AUDIT_POLL_MS = 2_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Drains the tenant's job queue until no audit job is pending or running (or the time is up). */
async function drainAuditJobs(): Promise<void> {
  const deadline = Date.now() + AUDIT_DRAIN_TIMEOUT_MS
  for (;;) {
    const result = await drainUserJobQueue({ userId: TENANT, limit: 50 })
    if (result.claimed > 0) {
      logEval(
        `audit jobs: claimed ${result.claimed}, completed ${result.completed}, gave up ${result.failed}`,
      )
    }
    if (!(await hasActiveJobForUser(TENANT, CAPTURE_REVIEW_AUDIT_JOB))) return
    if (Date.now() >= deadline) {
      logEval('audit jobs: still pending after the time limit; their reviews show as not scored')
      return
    }
    await sleep(AUDIT_POLL_MS)
  }
}

type StoredThought = {
  id: string
  text: string
  category: string
  enrichQueueStatus: string | null
  enrichQueueError: string | null
  splitFrom: string | null
}

async function readThoughts(db: AppDatabase): Promise<StoredThought[]> {
  const rows = await db
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      category: thought.category,
      enrichQueueStatus: thought.enrichQueueStatus,
      enrichQueueError: thought.enrichQueueError,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(eq(thought.userId, TENANT))
  return Promise.all(
    rows.map(async (row) => {
      const text = row.normalizedTextEncrypted
        ? await decryptTenantValue({
            userId: TENANT,
            table: 'thought',
            column: 'normalized_text',
            ciphertext: row.normalizedTextEncrypted,
          })
        : row.normalizedText
      const metadata: unknown = row.metadataEncrypted
        ? JSON.parse(
            await decryptTenantValue({
              userId: TENANT,
              table: 'thought',
              column: 'metadata',
              ciphertext: row.metadataEncrypted,
            }),
          )
        : row.metadata
      return {
        id: row.id,
        text,
        category: row.category,
        enrichQueueStatus: row.enrichQueueStatus,
        enrichQueueError: row.enrichQueueError,
        splitFrom: splitFromOf(metadata),
      }
    }),
  )
}

async function readAuditInput(
  thoughtId: string,
): Promise<{ audit: SmokeAuditView | null; error: string | null }> {
  try {
    const input = await loadCaptureAuditInput({ userId: TENANT, thoughtId })
    if (input === null) return { audit: null, error: 'the thought no longer exists' }
    return {
      audit: { names: input.names, dates: input.dates, pieces: input.pieces },
      error: null,
    }
  } catch (err) {
    return { audit: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function collectResults(
  captures: Array<{ text: string; capturedAt: string }>,
  rootIds: string[],
  billing: { billingUserId: string },
): Promise<SmokeCaptureResult[]> {
  return withEvalDb(
    TENANT,
    async (db) => {
      const thoughts = await readThoughts(db)
      const reviewRows = await db
        .select({
          thoughtId: captureReview.thoughtId,
          status: captureReview.status,
          score: captureReview.score,
          auditError: captureReview.auditError,
          parts: captureReview.parts,
        })
        .from(captureReview)
        .where(eq(captureReview.userId, TENANT))
      const reviewOf = new Map<string, SmokeReviewRow>(
        reviewRows.map((r) => [
          r.thoughtId,
          {
            status: r.status,
            score: r.score,
            auditError: r.auditError,
            parts: parseCaptureReviewParts(r.parts),
          },
        ]),
      )

      const thoughtResult = async (t: StoredThought): Promise<SmokeThoughtResult> => {
        const { audit, error } = await readAuditInput(t.id)
        return {
          thoughtId: t.id,
          splitChild: t.splitFrom !== null,
          text: t.text,
          category: t.category,
          enrichQueueStatus: t.enrichQueueStatus,
          enrichQueueError: t.enrichQueueError,
          review: reviewOf.get(t.id) ?? null,
          audit,
          auditInputError: error,
        }
      }

      const results: SmokeCaptureResult[] = []
      for (const [i, capture] of captures.entries()) {
        const root = thoughts.find((t) => t.id === rootIds[i])
        if (!root)
          throw new Error(`[capture-review] capture ${i + 1} (${rootIds[i]}) is not in the tenant`)
        const rootResult = await thoughtResult(root)
        const children = thoughts.filter((t) => t.splitFrom === root.id)
        const ordered = orderSplitChildren(
          children,
          (rootResult.audit?.pieces ?? []).map((p) => p.text),
        )
        results.push({
          index: i + 1,
          text: capture.text,
          capturedAt: capture.capturedAt,
          thoughts: [rootResult, ...(await Promise.all(ordered.map(thoughtResult)))],
        })
      }
      return results
    },
    billing,
  )
}

/** Runs the whole smoke; resolves to the process exit code (0 when every review is scored). */
export async function runSmoke(args: SmokeArgs): Promise<number> {
  const captures = loadSmokeFixture(SMOKE_FIXTURE_PATH)

  const billingUserId = resolveHarnessBillingUserId(TENANT)
  if (billingUserId !== PUBLIC_BENCH_OPERATOR_USER_ID) {
    throw new Error(
      `[capture-review] tenant ${TENANT} resolves to billing wallet ${billingUserId ?? '(none)'}, not ${PUBLIC_BENCH_OPERATOR_USER_ID}`,
    )
  }
  // Every audit needs Jev; without it each one would fail after its retries. Fail now instead.
  if (resolveDecisionShadowConfig() === null) {
    throw new Error(
      '[capture-review] the smoke needs the Jev decision model: set DECISION_SHADOW_ENABLED=true, OPENROUTER_API_KEY and DECISION_SHADOW_MODEL',
    )
  }
  await ensurePublicBenchOperator({
    operatorUserId: billingUserId,
    displayName: 'Public Bench Runner',
    chatModel: PLATFORM_CHAT_MODEL,
  })

  logEval(
    `capture-review smoke: tenant ${TENANT}, billed to ${billingUserId}, chat model ${PLATFORM_CHAT_MODEL} (platform default), ` +
      `DECISION_ENFORCE_KINDS=${[...resolveDecisionEnforceKinds()].join(',') || '(none)'}, ${captures.length} capture(s), no eval LLM cache`,
  )

  if (args.keep) {
    await insertEvalUserRow(TENANT, TENANT_NAME)
    logEval(`--keep: tenant ${TENANT} kept as it is`)
  } else {
    await deleteEvalUserRow(TENANT)
    await insertEvalUserRow(TENANT, TENANT_NAME)
    logEval(`tenant ${TENANT} reset`)
  }

  const billing = { billingUserId }
  const rootIds: string[] = []
  for (const [i, capture] of captures.entries()) {
    logEval(`capture ${i + 1}/${captures.length} at ${capture.capturedAt}: ${capture.text}`)
    const thoughtId = await withEvalDb(
      TENANT,
      async () => {
        const queued = await queueCapture(TENANT, capture.text, {
          source: 'eval',
          skipWorker: true,
          capturedAt: capture.capturedAtDate,
        })
        // The drain swallows non-fatal enrich failures; the report shows them as a missing review.
        await processCaptureEnrichQueue(TENANT, { concurrency: 1 })
        return queued.thoughtId
      },
      { ...billing, clock: capture.capturedAtDate },
    )
    rootIds.push(thoughtId)
    logEval(`capture ${i + 1}: thought ${thoughtId} drained, running its audit jobs`)
    await drainAuditJobs()
  }

  const results = await collectResults(captures, rootIds, billing)
  console.log(formatSmokeReport(results))
  return smokeExitCode(results)
}
