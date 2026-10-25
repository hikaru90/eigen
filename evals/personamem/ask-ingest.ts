import type { DrainQueue, IngestItem } from '../public-bench/ingest-tenant'
import type { AskTurnRecord } from './types'
import { eq } from 'drizzle-orm'
import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought'
import { getOrCreateSession, runAskTurn, type AskToolCall } from '$lib/server/chat/run-ask-turn'
import type { AppDatabase } from '$lib/server/db'
import { logEval, withEvalDb } from '../harness/eval-context'
import {
  loadThoughtEnrichmentTargets,
  waitForThoughtEnrichmentComplete,
} from '../harness/wait-enrichment'
import { tenantTotalUsd } from '../public-bench/cost'

type Billing = { billingUserId: string; chatModel: string }

export type StoredThought = { id: string; createdAt: Date }

export type AskIngestDeps = {
  /** One Ask turn inside the tenant's eval DB context. Default: `runAskTurn` with persisted steps. */
  runTurn: (input: {
    db: AppDatabase
    tenantUserId: string
    sessionId: string
    message: string
  }) => Promise<{ toolCalls: AskToolCall[] }>
  /** Every thought of the tenant (inside the tenant's eval DB context). */
  listThoughts: (db: AppDatabase, tenantUserId: string) => Promise<StoredThought[]>
  drainQueue: DrainQueue
  /** Block until every given thought has `enriched_at` (re-enriches stragglers). */
  waitEnriched: (tenantUserId: string, thoughtIds: string[], billing: Billing) => Promise<void>
  /** Tenant's whole USD spend so far. */
  totalUsd: (tenantUserId: string) => Promise<number>
}

export type AskIngestInput = {
  tenantUserId: string
  personaId: number
  billingUserId: string
  chatModel: string
  /** User turns in history order; `capturedAt` is the turn's eval clock. */
  turns: IngestItem[]
  enrichConcurrency: number
  /** Called after each finished turn (progress / persistence). */
  onTurn?: (record: AskTurnRecord) => void
  deps?: Partial<AskIngestDeps>
}

const CAPTURE_TOOL = 'capture_thought'
const DELETE_TOOLS = new Set(['delete_thought', 'delete_thoughts_by_request'])

const defaultRunTurn: AskIngestDeps['runTurn'] = async (input) => {
  const result = await runAskTurn({
    db: input.db,
    userId: input.tenantUserId,
    sessionId: input.sessionId,
    message: input.message,
    persistSteps: true,
  })
  return { toolCalls: result.toolCalls }
}

const defaultListThoughts: AskIngestDeps['listThoughts'] = async (db, tenantUserId) => {
  const { thought } = await import('$lib/server/db/schema')
  return db
    .select({ id: thought.id, createdAt: thought.createdAt })
    .from(thought)
    .where(eq(thought.userId, tenantUserId))
}

const defaultWaitEnriched: AskIngestDeps['waitEnriched'] = (tenantUserId, thoughtIds, billing) =>
  withEvalDb(
    tenantUserId,
    async (db) => {
      const targets = await loadThoughtEnrichmentTargets(db, tenantUserId, thoughtIds)
      await waitForThoughtEnrichmentComplete({
        db,
        userId: tenantUserId,
        targets,
        withEvalDbOptions: billing,
      })
    },
    billing,
  )

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

function successfulCalls(calls: readonly AskToolCall[], match: (tool: string) => boolean): number {
  return calls.filter((c) => !c.failed && match(c.tool)).length
}

/**
 * Replays a persona's user turns through ONE Ask chat session, strictly in order: for turn n,
 * Ask runs under `clock = epoch + n days` (so a capture without its own `captured_at` is
 * stamped with it), then the tenant's enrich queue is drained and every thought the turn
 * created is enriched before turn n+1 starts (D6: facts arrive in order).
 *
 * The turn's new thoughts are the tenant's thought ids after the turn minus the ids before it,
 * both read inside the turn's own DB context. Unlike the capture_thought tool results (which
 * carry no ids in the agent's tool-call events) or `enriched_at IS NULL` (which also matches
 * thoughts whose enrich failed in an earlier turn), the diff is exactly "created by this turn",
 * including split / fan-out children and any other path Ask takes to create a thought.
 *
 * Wipes the tenant first. Returns one record per turn.
 */
export async function ingestTenantViaAsk(input: AskIngestInput): Promise<AskTurnRecord[]> {
  const { tenantUserId, personaId, billingUserId, chatModel, turns, enrichConcurrency } = input
  if (!tenantUserId.trim()) throw new Error('[personamem] tenantUserId must be non-empty')
  if (!billingUserId.trim()) throw new Error('[personamem] billingUserId must be non-empty')
  if (!chatModel.trim()) throw new Error('[personamem] chatModel must be non-empty')
  if (!Number.isInteger(enrichConcurrency) || enrichConcurrency < 1) {
    throw new Error(
      `[personamem] enrichConcurrency must be a positive integer, got: ${enrichConcurrency}`,
    )
  }
  if (turns.length === 0) throw new Error(`[personamem] turns is empty for ${tenantUserId}`)
  const resolvedBilling = resolveHarnessBillingUserId(tenantUserId)
  if (resolvedBilling !== billingUserId) {
    throw new Error(
      `[personamem] tenant ${tenantUserId} resolves to billing wallet ${resolvedBilling ?? '(none)'}, ` +
        `not ${billingUserId}; name harness tenants with a prefix registered in harness-billing.ts`,
    )
  }
  const deps: AskIngestDeps = {
    runTurn: defaultRunTurn,
    listThoughts: defaultListThoughts,
    drainQueue: processCaptureEnrichQueue,
    waitEnriched: defaultWaitEnriched,
    totalUsd: tenantTotalUsd,
    ...input.deps,
  }
  const billing: Billing = { billingUserId, chatModel }

  await deleteEvalUserRow(tenantUserId)
  await insertEvalUserRow(tenantUserId, `Public bench tenant ${tenantUserId}`)

  const { sessionId } = await withEvalDb(
    tenantUserId,
    (db) => getOrCreateSession(db, tenantUserId, null, 'default'),
    billing,
  )
  logEval(
    `${tenantUserId}: replaying ${turns.length} user turn(s) through Ask session ${sessionId}, enrich_concurrency=${enrichConcurrency}`,
  )

  const records: AskTurnRecord[] = []
  for (const [index, item] of turns.entries()) {
    const startedMs = Date.now()
    const usdBefore = await deps.totalUsd(tenantUserId)

    const { toolCalls, created } = await withEvalDb(
      tenantUserId,
      async (db) => {
        const before = new Set((await deps.listThoughts(db, tenantUserId)).map((t) => t.id))
        const result = await deps.runTurn({
          db,
          tenantUserId,
          sessionId,
          message: item.rawText,
        })
        const after = await deps.listThoughts(db, tenantUserId)
        return { toolCalls: result.toolCalls, created: after.filter((t) => !before.has(t.id)) }
      },
      { ...billing, clock: item.capturedAt },
    )
    const usdAfterAsk = await deps.totalUsd(tenantUserId)

    // Drain even when the turn stored nothing (cheap, and edits can queue a re-enrich); wait
    // only for what this turn created.
    await withEvalDb(
      tenantUserId,
      () => deps.drainQueue(tenantUserId, { concurrency: enrichConcurrency }),
      billing,
    )
    if (created.length > 0) {
      await deps.waitEnriched(
        tenantUserId,
        created.map((t) => t.id),
        billing,
      )
    }
    const usdAfterEnrich = await deps.totalUsd(tenantUserId)

    const askUsd = round6(usdAfterAsk - usdBefore)
    const enrichUsd = round6(usdAfterEnrich - usdAfterAsk)
    const record: AskTurnRecord = {
      personaId,
      tenantUserId,
      turn: index,
      clock: item.capturedAt.toISOString(),
      captures: successfulCalls(toolCalls, (tool) => tool === CAPTURE_TOOL),
      deletes: successfulCalls(toolCalls, (tool) => DELETE_TOOLS.has(tool)),
      toolNames: toolCalls.map((c) => c.tool),
      thoughtsCreated: created.length,
      clockMismatches: created.filter((t) => t.createdAt.getTime() !== item.capturedAt.getTime())
        .length,
      askUsd,
      enrichUsd,
      usd: round6(askUsd + enrichUsd),
      ms: Date.now() - startedMs,
    }
    records.push(record)
    input.onTurn?.(record)
    logEval(
      `${tenantUserId} turn ${index + 1}/${turns.length}: captures=${record.captures} deletes=${record.deletes} created=${record.thoughtsCreated} usd=${record.usd}`,
    )
  }
  return records
}
