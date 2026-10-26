import { deleteEvalUserRow, insertEvalUserRow } from '$lib/eval/store'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { logEval, withEvalDb } from '../harness/eval-context'
import { RunStopped } from '../harness/stop-signal'
import {
  loadThoughtEnrichmentTargets,
  waitForThoughtEnrichmentComplete,
} from '../harness/wait-enrichment'
import { appendEnriched, appendQueued, type TenantIngestProgress } from './ingest-progress'

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

/** The database reads and writes a durable ingest needs (injectable; the live one is in the bench's own module). */
export type IngestStore = {
  /** Wipe and recreate the tenant (explicit `--fresh` only). */
  resetTenant(tenantUserId: string): Promise<void>
  /** Create the tenant if it does not exist yet; never deletes. */
  ensureTenant(tenantUserId: string): Promise<void>
  /** Every thought the tenant holds, split children included. */
  thoughtCount(tenantUserId: string): Promise<number>
  /** Thoughts that are not split children (what the progress file calls captures). */
  rootCount(tenantUserId: string): Promise<number>
  /** For each capture thought: itself first, then its split descendants. */
  families(tenantUserId: string, rootIds: string[]): Promise<Map<string, string[]>>
  /**
   * Checks the thoughts recorded as enriched: which do not exist, and which capture thoughts
   * (first id of each family) have no `enriched_at`.
   */
  verifyRecorded(
    tenantUserId: string,
    families: ReadonlyMap<number, string[]>,
  ): Promise<{ missing: string[]; unenriched: string[] }>
}

/** What a resume did, for the run's counters. */
export type IngestCounters = {
  /** Captures already enriched in an earlier process: nothing was called for them. */
  skipped: number
  /** Captures queued earlier but not enriched: finished by re-enriching, not re-queued. */
  reenriched: number
  /** Captures queued by this process. */
  queued: number
}

/** Makes an ingest crash-safe and resumable from `ingest-progress.jsonl`. */
export type DurableIngest = {
  progressPath: string
  /** This tenant's state from earlier processes (empty for a new tenant). */
  progress: TenantIngestProgress
  /** Explicit `--fresh`: reset the tenant, but only before its first capture is recorded. */
  fresh: boolean
  store: IngestStore
  counters: IngestCounters
  /** Checked before each wave; true throws `RunStopped` (a clean stop, not a failure). */
  shouldStop?: () => boolean
}

export type IngestTenantInput = {
  tenantUserId: string
  billingUserId: string
  /** Chat model (`vendor/name`) for every LLM call of the ingest (capture, enrich). */
  chatModel: string
  items: IngestItem[]
  enrichConcurrency: number
  /** Injectable for tests. */
  queueItem?: QueueItem
  /** Injectable for tests. */
  drainQueue?: DrainQueue
  /**
   * Without it (LongMemEval) the tenant is wiped and ingested from zero. With it the ingest
   * records every capture durably and continues from those records; nothing is deleted unless
   * `durable.fresh`.
   */
  durable?: DurableIngest
}

const queueTenantItem: QueueItem = async (tenantUserId, item) => {
  const queued = await queueCapture(tenantUserId, item.rawText, {
    source: 'eval',
    skipWorker: true,
    capturedAt: item.capturedAt,
  })
  return queued.thoughtId
}

/**
 * Capture items into the tenant in waves of `enrichConcurrency`: queue a wave, drain it, wait
 * until its thoughts are enriched, only then queue the next wave. Facts therefore arrive in
 * order (queueCapture already anchors graph links at queue time, so a later item must not exist
 * while an earlier one is still being enriched); `enrichConcurrency` 1 is strictly incremental.
 * Returns the thought ids in item order.
 *
 * Plain mode wipes the tenant first. Durable mode (`input.durable`) never deletes without an
 * explicit `fresh` and continues from the progress file: enriched captures are verified in the
 * database and skipped, queued-but-not-enriched captures are re-enriched (never queued again),
 * the rest are queued.
 */
export async function ingestTenant(input: IngestTenantInput): Promise<string[]> {
  const { tenantUserId, billingUserId, chatModel, items, enrichConcurrency, durable } = input
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

  const billing = { billingUserId, chatModel }
  if (durable === undefined) {
    await deleteEvalUserRow(tenantUserId)
    await insertEvalUserRow(tenantUserId, `Public bench tenant ${tenantUserId}`)
  } else {
    await prepareDurableTenant(tenantUserId, items.length, durable)
  }

  logEval(
    `${tenantUserId}: ingesting ${items.length} capture(s), enrich_concurrency=${enrichConcurrency}`,
  )

  const queueItem = input.queueItem ?? queueTenantItem
  const drainQueue = input.drainQueue ?? processCaptureEnrichQueue
  const thoughtIds: string[] = []

  for (let start = 0; start < items.length; start += enrichConcurrency) {
    const indexes = Array.from(
      { length: Math.min(enrichConcurrency, items.length - start) },
      (_, j) => start + j,
    )

    if (durable !== undefined && indexes.every((i) => durable.progress.enriched.has(i))) {
      thoughtIds.push(...indexes.map((i) => durable.progress.enriched.get(i)![0]!))
      continue
    }
    if (durable?.shouldStop?.()) throw new RunStopped()

    const waveIds = await withEvalDb(
      tenantUserId,
      async () => {
        const ids: string[] = []
        for (const index of indexes) {
          const recorded = durable?.progress.queued[index]
          if (recorded !== undefined) {
            ids.push(recorded)
            continue
          }
          const thoughtId = await queueItem(tenantUserId, items[index]!)
          ids.push(thoughtId)
          if (durable !== undefined) {
            appendQueued(durable.progressPath, { tenant: tenantUserId, index, thoughtId })
            durable.progress.queued.push(thoughtId)
            durable.counters.queued += 1
          }
        }
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

    if (durable !== undefined) {
      const families = await durable.store.families(tenantUserId, waveIds)
      indexes.forEach((index, j) => {
        if (durable.progress.enriched.has(index)) return
        const thoughtId = waveIds[j]!
        const family = families.get(thoughtId)
        if (family === undefined) {
          throw new Error(`[public-bench] ${tenantUserId}: capture thought ${thoughtId} is not in the database after enrich`)
        }
        appendEnriched(durable.progressPath, { tenant: tenantUserId, index, thoughtIds: family })
        durable.progress.enriched.set(index, family)
      })
    }

    thoughtIds.push(...waveIds)
  }

  return thoughtIds
}

/**
 * Durable mode, before any capture: a new tenant is reset only with `--fresh` (and a tenant that
 * already holds thoughts is refused without it); a tenant with recorded captures is checked
 * against the database and never touched.
 */
async function prepareDurableTenant(
  tenantUserId: string,
  captures: number,
  durable: DurableIngest,
): Promise<void> {
  const { progress, store } = durable
  if (progress.queued.length === 0) {
    if (durable.fresh) {
      await store.resetTenant(tenantUserId)
      return
    }
    await store.ensureTenant(tenantUserId)
    const held = await store.thoughtCount(tenantUserId)
    if (held > 0) {
      throw new Error(
        `[public-bench] tenant ${tenantUserId} already holds ${held} thought(s) from an earlier run; ingesting into it would double them. ` +
          'Start a new run with --fresh to reset it (--resume never deletes anything)',
      )
    }
    return
  }

  if (durable.fresh) {
    throw new Error(
      `[public-bench] tenant ${tenantUserId}: --fresh is only allowed before the tenant's first capture is recorded, but ${progress.queued.length} capture(s) are already recorded; continue with --resume or start a new --run-id`,
    )
  }
  if (progress.queued.length > captures) {
    throw new Error(
      `[public-bench] tenant ${tenantUserId}: ${progress.queued.length} capture(s) are recorded but this run plans ${captures}`,
    )
  }
  const roots = await store.rootCount(tenantUserId)
  if (roots !== progress.queued.length) {
    throw new Error(
      `[public-bench] tenant ${tenantUserId} holds ${roots} root thought(s) but the progress file has ${progress.queued.length} queued (a capture committed without being recorded, or the tenant was changed); start a new --run-id with --fresh`,
    )
  }
  if (progress.enriched.size > 0) {
    const { missing, unenriched } = await store.verifyRecorded(tenantUserId, progress.enriched)
    if (missing.length > 0) {
      throw new Error(
        `[public-bench] tenant ${tenantUserId}: ${missing.length} thought(s) the progress file records are not in the database, e.g. ${missing[0]} (the tenant was reset or changed since); start a new --run-id with --fresh`,
      )
    }
    if (unenriched.length > 0) {
      throw new Error(
        `[public-bench] tenant ${tenantUserId}: ${unenriched.length} thought(s) recorded as enriched in the progress file are not enriched in the database, e.g. ${unenriched[0]}`,
      )
    }
  }
  durable.counters.skipped += progress.enriched.size
  durable.counters.reenriched += progress.queued.length - progress.enriched.size
  logEval(
    `${tenantUserId}: resuming - ${progress.enriched.size}/${captures} capture(s) already enriched, ` +
      `${progress.queued.length - progress.enriched.size} queued but not enriched (re-enriched, not re-queued), ` +
      `${captures - progress.queued.length} still to queue`,
  )
}
