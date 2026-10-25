import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { logEval, withEvalDb } from '../harness/eval-context'
import {
  loadThoughtEnrichmentTargets,
  waitForThoughtEnrichmentComplete,
} from '../harness/wait-enrichment'

export type IngestItem = {
  rawText: string
  capturedAt: Date
}

/** Queue one capture (inside the tenant's eval DB context); resolves to the thought id. */
export type QueueItem = (tenantUserId: string, item: IngestItem) => Promise<string>

/** Drain the tenant's pending enrich rows with the given worker concurrency. */
export type DrainQueue = (
  tenantUserId: string,
  options: { concurrency: number },
) => Promise<unknown>

export type ListThoughtIds = (
  tenantUserId: string,
  billingUserId: string,
  chatModel: string,
) => Promise<string[]>

export type IngestTenantInput = {
  tenantUserId: string
  billingUserId: string
  /** Chat model (`vendor/name`) for every LLM call of the ingest (capture, enrich). */
  chatModel: string
  items: IngestItem[]
  enrichConcurrency: number
  /** true: wipe the tenant and ingest. false: assert it already holds exactly `items.length` thoughts and skip. */
  reset: boolean
  /** Existing thought ids of the tenant, oldest first (injectable for tests). */
  listThoughtIds?: ListThoughtIds
  /** Injectable for tests. */
  queueItem?: QueueItem
  /** Injectable for tests. */
  drainQueue?: DrainQueue
}

const queueTenantItem: QueueItem = async (tenantUserId, item) => {
  const queued = await queueCapture(tenantUserId, item.rawText, {
    source: 'eval',
    skipWorker: true,
    capturedAt: item.capturedAt,
  })
  return queued.thoughtId
}

const listTenantThoughtIds: ListThoughtIds = (tenantUserId, billingUserId, chatModel) =>
  withEvalDb(
    tenantUserId,
    async (db) => {
      const { thought } = await import('$lib/server/db/schema')
      const { asc, eq } = await import('drizzle-orm')
      const rows = await db
        .select({ id: thought.id })
        .from(thought)
        .where(eq(thought.userId, tenantUserId))
        .orderBy(asc(thought.createdAt), asc(thought.id))
      return rows.map((r) => r.id)
    },
    { billingUserId, chatModel },
  )

/**
 * Capture items into the tenant in waves of `enrichConcurrency`: queue a wave, drain it, wait
 * until its thoughts are enriched, only then queue the next wave. Facts therefore arrive in
 * order (queueCapture already anchors graph links at queue time, so a later item must not exist
 * while an earlier one is still being enriched); `enrichConcurrency` 1 is strictly incremental.
 * Returns the thought ids in item order.
 */
export async function ingestTenant(input: IngestTenantInput): Promise<string[]> {
  const { tenantUserId, billingUserId, chatModel, items, enrichConcurrency, reset } = input
  if (!tenantUserId.trim()) throw new Error('[public-bench] tenantUserId must be non-empty')
  if (!billingUserId.trim()) throw new Error('[public-bench] billingUserId must be non-empty')
  if (!chatModel.trim()) throw new Error('[public-bench] chatModel must be non-empty')
  if (!Number.isInteger(enrichConcurrency) || enrichConcurrency < 1) {
    throw new Error(
      `[public-bench] enrichConcurrency must be a positive integer, got: ${enrichConcurrency}`,
    )
  }
  if (items.length === 0) throw new Error(`[public-bench] items is empty for ${tenantUserId}`)
  const resolvedBilling = resolveHarnessBillingUserId(tenantUserId)
  if (resolvedBilling !== billingUserId) {
    throw new Error(
      `[public-bench] tenant ${tenantUserId} resolves to billing wallet ${resolvedBilling ?? '(none)'}, ` +
        `not ${billingUserId}; name harness tenants with a prefix registered in harness-billing.ts`,
    )
  }

  if (!reset) {
    const existing = await (input.listThoughtIds ?? listTenantThoughtIds)(
      tenantUserId,
      billingUserId,
      chatModel,
    )
    if (existing.length !== items.length) {
      throw new Error(
        `[public-bench] cannot reuse tenant ${tenantUserId}: it holds ${existing.length} thought(s), expected ${items.length}`,
      )
    }
    logEval(`${tenantUserId}: reusing ${existing.length} existing thought(s)`)
    return existing
  }

  await deleteEvalUserRow(tenantUserId)
  await insertEvalUserRow(tenantUserId, `Public bench tenant ${tenantUserId}`)

  logEval(
    `${tenantUserId}: ingesting ${items.length} capture(s), enrich_concurrency=${enrichConcurrency}`,
  )

  const billing = { billingUserId, chatModel }
  const queueItem = input.queueItem ?? queueTenantItem
  const drainQueue = input.drainQueue ?? processCaptureEnrichQueue
  const thoughtIds: string[] = []

  for (let start = 0; start < items.length; start += enrichConcurrency) {
    const wave = items.slice(start, start + enrichConcurrency)

    const waveIds = await withEvalDb(
      tenantUserId,
      async () => {
        const ids: string[] = []
        for (const item of wave) ids.push(await queueItem(tenantUserId, item))
        await drainQueue(tenantUserId, { concurrency: enrichConcurrency })
        return ids
      },
      billing,
    )

    // The drain swallows non-fatal enrich failures; the wait re-enriches those before the next
    // wave is queued, so a retried fact is also processed before any later one exists.
    await withEvalDb(
      tenantUserId,
      async (db) => {
        const targets = await loadThoughtEnrichmentTargets(db, tenantUserId, waveIds)
        await waitForThoughtEnrichmentComplete({
          db,
          userId: tenantUserId,
          targets,
          withEvalDbOptions: billing,
        })
      },
      billing,
    )

    thoughtIds.push(...waveIds)
  }

  return thoughtIds
}
