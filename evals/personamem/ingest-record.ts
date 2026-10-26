import type { CaptureItem } from './history-to-captures'
import { createHash } from 'node:crypto'
import { z } from 'zod'

/**
 * One line of a run's ingest.jsonl: what ingesting one tenant produced. Everything a later run
 * needs to answer against that tenant without re-ingesting (`--reuse-ingest`), and to find the
 * thoughts each capture became.
 */
export const ingestRecordSchema = z
  .object({
    personaId: z.number().int(),
    tenantUserId: z.string().min(1),
    /** Captures made: one per user turn queued. */
    captures: z.number().int().nonnegative(),
    /** sha256 of the captures that were queued (text and capture time, in order). */
    captureDigest: z.string().regex(/^[0-9a-f]{64}$/),
    /** The thought each capture was queued as, in capture order (split children are not listed). */
    thoughtIds: z.array(z.string().refine((s) => s.trim().length > 0, 'must not be blank')),
    /** Every thought the tenant held after ingest, split children included. */
    thoughtCount: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
    ms: z.number().nonnegative(),
  })
  .strict()
export type IngestRecord = z.infer<typeof ingestRecordSchema>

/** Identifies a capture list: the same texts at the same times in the same order, nothing else. */
export function captureDigest(captures: readonly CaptureItem[]): string {
  const hash = createHash('sha256')
  for (const c of captures) {
    // length-prefixed, so ["ab"] and ["a", "b"] differ
    hash.update(`${c.rawText.length}:${c.rawText}@${c.capturedAt.toISOString()}\n`)
  }
  return hash.digest('hex')
}
