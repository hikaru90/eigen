import type { PlannedPersona } from './plan'
import { readJsonl } from '../public-bench/run-output'
import { captureDigest, ingestRecordSchema, type IngestRecord } from './ingest-record'
import { loadRunMeta, type RunIdentity, type RunMeta } from './run-meta'

/**
 * `--reuse-ingest <runId>`: answer against the tenants an earlier run ingested. Nothing is
 * trusted by name alone: the source run's identity, its per-tenant ingest records (capture
 * count, capture digest, thought ids) and, live, the tenant's thoughts must all match what this
 * run is about to ask. Any mismatch fails loud. The same checks guard `--resume` (a run's own
 * ingest.jsonl is the source), which replaces the old thought-count == capture-count check that
 * Phase A split children broke.
 */

export type IngestSource = { meta: RunMeta; records: IngestRecord[] }

export type IngestIdentity = Pick<
  RunIdentity,
  'split' | 'chatModel' | 'evidenceOnly' | 'enrichConcurrency'
>

export function loadIngestSource(runId: string, reportsRoot?: string): IngestSource {
  const { paths, meta } = loadRunMeta(runId, reportsRoot)
  const records = readJsonl(paths.ingest).map((row, i) => {
    const parsed = ingestRecordSchema.safeParse(row)
    if (!parsed.success) {
      throw new Error(
        `[personamem] run ${runId}: ingest.jsonl row ${i + 1} is invalid (${parsed.error.message}); ` +
          'a run made before ingest records carried thought ids cannot be reused - re-ingest',
      )
    }
    return parsed.data
  })
  return { meta, records }
}

/**
 * The verified ingest record of every planned tenant. `requireAll`: each planned tenant must
 * have one (reuse); otherwise tenants without a record are left out (resume: they are ingested
 * by this run). Pure: no database.
 */
export function verifyIngestRecords(input: {
  sourceRunId: string
  source: IngestSource
  current: IngestIdentity
  planned: readonly PlannedPersona[]
  requireAll: boolean
}): Map<string, IngestRecord> {
  const { sourceRunId, source, current, planned } = input
  const saved = source.meta.identity
  const differs = (flag: string, was: unknown, now: unknown) => {
    throw new Error(
      `[personamem] cannot reuse the ingest of run ${sourceRunId}: it ran with ${flag} ${String(was)}, this run says ${flag} ${String(now)}`,
    )
  }
  if (saved.split !== current.split) differs('--split', saved.split, current.split)
  if (saved.chatModel !== current.chatModel)
    differs('--chat-model', saved.chatModel, current.chatModel)
  if (saved.evidenceOnly !== current.evidenceOnly) {
    differs('--evidence-only', saved.evidenceOnly, current.evidenceOnly)
  }
  if (saved.enrichConcurrency !== current.enrichConcurrency) {
    differs('--enrich-concurrency', saved.enrichConcurrency, current.enrichConcurrency)
  }

  const byTenant = new Map<string, IngestRecord>()
  for (const record of source.records) {
    if (byTenant.has(record.tenantUserId)) {
      throw new Error(
        `[personamem] run ${sourceRunId}: tenant ${record.tenantUserId} was ingested more than once (ingest.jsonl is damaged)`,
      )
    }
    byTenant.set(record.tenantUserId, record)
  }

  const verified = new Map<string, IngestRecord>()
  for (const persona of planned) {
    const tenant = persona.tenantUserId
    const record = byTenant.get(tenant)
    if (record === undefined) {
      if (input.requireAll) {
        throw new Error(
          `[personamem] run ${sourceRunId} did not ingest tenant ${tenant} (it ingested ${source.records.length} tenant(s)); nothing to reuse`,
        )
      }
      continue
    }
    if (record.captures !== persona.captures.length) {
      throw new Error(
        `[personamem] tenant ${tenant}: run ${sourceRunId} ingested ${record.captures} capture(s), this run plans ${persona.captures.length}`,
      )
    }
    if (record.captureDigest !== captureDigest(persona.captures)) {
      throw new Error(
        `[personamem] tenant ${tenant}: run ${sourceRunId} ingested different captures than this run plans (same count ${record.captures}, other text or order)`,
      )
    }
    if (record.thoughtIds.length !== record.captures) {
      throw new Error(
        `[personamem] tenant ${tenant}: run ${sourceRunId} recorded ${record.thoughtIds.length} thought id(s) for ${record.captures} capture(s) (ingest.jsonl is damaged)`,
      )
    }
    if (new Set(record.thoughtIds).size !== record.thoughtIds.length) {
      throw new Error(
        `[personamem] tenant ${tenant}: run ${sourceRunId} lists a thought id twice (ingest.jsonl is damaged)`,
      )
    }
    verified.set(tenant, record)
  }
  return verified
}

/**
 * The tenant in the database is the one the record describes: every recorded thought id is
 * still there and the tenant holds exactly as many thoughts as after ingest (split children
 * included), so nothing was re-ingested, edited or answered into since.
 */
export function verifyLiveTenant(input: {
  sourceRunId: string
  record: IngestRecord
  live: { thoughtIds: ReadonlySet<string>; thoughtCount: number }
}): void {
  const { sourceRunId, record, live } = input
  const missing = record.thoughtIds.filter((id) => !live.thoughtIds.has(id))
  if (missing.length > 0) {
    throw new Error(
      `[personamem] tenant ${record.tenantUserId}: ${missing.length} thought(s) recorded by run ${sourceRunId} are not in the database, e.g. ${missing[0]} (the tenant was re-ingested or changed since); re-ingest`,
    )
  }
  if (live.thoughtCount !== record.thoughtCount) {
    throw new Error(
      `[personamem] tenant ${record.tenantUserId}: run ${sourceRunId} left ${record.thoughtCount} thought(s), the database holds ${live.thoughtCount} now; re-ingest`,
    )
  }
}
