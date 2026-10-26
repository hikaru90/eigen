import { z } from 'zod'
import { appendJsonl, readJsonl } from './run-output'

/**
 * `ingest-progress.jsonl`: the durable, per-capture record of an ingest (the unit a `--resume`
 * continues from). Two phases per capture, in this order:
 *
 *   queued   {tenant, index, thoughtId}      right after `queueCapture` committed the thought
 *   enriched {tenant, index, thoughtIds}     after the wave's drain + wait; thoughtIds[0] is the
 *                                            capture thought, the rest are its split children
 *
 * A capture that is queued but not enriched is finished by re-enriching that thought; it is
 * never queued again. Rows are appended with fsync, so a kill loses at most the row being
 * written. Never holds text or vectors.
 */

const nonBlank = z.string().refine((s) => s.trim().length > 0, 'must not be blank')

const queuedRowSchema = z
  .object({
    type: z.literal('queued'),
    at: z.string(),
    tenant: nonBlank,
    index: z.number().int().nonnegative(),
    thoughtId: nonBlank,
  })
  .strict()

const enrichedRowSchema = z
  .object({
    type: z.literal('enriched'),
    at: z.string(),
    tenant: nonBlank,
    index: z.number().int().nonnegative(),
    thoughtIds: z.array(nonBlank).min(1),
  })
  .strict()

const progressRowSchema = z.discriminatedUnion('type', [queuedRowSchema, enrichedRowSchema])

export type TenantIngestProgress = {
  /** thoughtId of capture `i` (contiguous from 0: capture i is queued only after capture i-1). */
  queued: string[]
  /** Capture index -> its thought and split children, for captures whose enrich finished. */
  enriched: Map<number, string[]>
}

export const emptyTenantProgress = (): TenantIngestProgress => ({
  queued: [],
  enriched: new Map(),
})

export function appendQueued(
  path: string,
  row: { tenant: string; index: number; thoughtId: string },
): void {
  appendJsonl(path, queuedRowSchema.parse({ type: 'queued', at: new Date().toISOString(), ...row }))
}

export function appendEnriched(
  path: string,
  row: { tenant: string; index: number; thoughtIds: string[] },
): void {
  appendJsonl(
    path,
    enrichedRowSchema.parse({ type: 'enriched', at: new Date().toISOString(), ...row }),
  )
}

/** Every tenant's progress; any row that cannot be right means the file is damaged and throws. */
export function loadIngestProgress(path: string): Map<string, TenantIngestProgress> {
  const byTenant = new Map<string, TenantIngestProgress>()
  const damaged = (line: number, why: string): never => {
    throw new Error(
      `[public-bench] ${path} line ${line} is invalid (damaged ingest-progress.jsonl): ${why}`,
    )
  }
  readJsonl(path).forEach((raw, i) => {
    const line = i + 1
    const parsed = progressRowSchema.safeParse(raw)
    if (!parsed.success) return damaged(line, parsed.error.message)
    const row = parsed.data
    const progress = byTenant.get(row.tenant) ?? emptyTenantProgress()
    byTenant.set(row.tenant, progress)
    if (row.type === 'queued') {
      if (row.index !== progress.queued.length) {
        damaged(
          line,
          `tenant ${row.tenant} queued capture ${row.index}, expected ${progress.queued.length}`,
        )
      }
      if (progress.queued.includes(row.thoughtId)) {
        damaged(line, `tenant ${row.tenant} queued thought ${row.thoughtId} twice`)
      }
      progress.queued.push(row.thoughtId)
      return
    }
    const queuedId = progress.queued[row.index]
    if (queuedId === undefined) {
      damaged(line, `tenant ${row.tenant} enriched capture ${row.index} before it was queued`)
    }
    if (progress.enriched.has(row.index)) {
      damaged(line, `tenant ${row.tenant} enriched capture ${row.index} twice`)
    }
    if (row.thoughtIds[0] !== queuedId) {
      damaged(
        line,
        `tenant ${row.tenant} capture ${row.index} was queued as ${queuedId}, enriched as ${row.thoughtIds[0]}`,
      )
    }
    progress.enriched.set(row.index, row.thoughtIds)
  })
  return byTenant
}
