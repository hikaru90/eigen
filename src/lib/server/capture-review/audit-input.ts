/**
 * Loads what the capture audit needs to know about one thought and shapes it as the input of the
 * Jev audit question builder (`CaptureAuditInput`, docs/planning/capture-feedback.md §4).
 *
 * Every field comes from a persisted source, so the audit judges what Eigen stored, not what a
 * model said in memory:
 * - texts: the thought's raw and normalized text (decrypted the way enrichment does);
 * - time zone: the user's preferred time zone, the same source enrichment gives temporal extraction;
 * - names: the mention surfaces in `entity_resolution_log` for this thought. That table is the
 *   per-thought record of what entity extraction found: enrichment clears and rewrites it on every
 *   run, so it always mirrors the latest extraction. `thought_entity` and `canonical_entity` hold
 *   canonical labels (what a mention resolved to), not the surface the chat model read in the text.
 *   Limit: mentions typed `project` resolve through project identity and leave no log row, so a
 *   project name the capture mentions is not in the list the audit sees;
 * - dates: the thought's `temporal_event` rows, described by `describeTemporalEvent`;
 * - pieces: the texts a multi-task fan-out split the capture into, from the parent's
 *   `metadata.splitInto` (see `fanOutMultipleTasks`). A child carries `metadata.splitFrom` and gets
 *   no pieces; a capture that was not split has none.
 */

import type { CaptureAuditInput } from './audit-questions'
import { and, asc, eq } from 'drizzle-orm'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { entityResolutionLog, temporalEvent, thought } from '$lib/server/db/schema'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { describeTemporalEvent } from './temporal-detail'

async function decryptText(
  userId: string,
  column: 'raw_text' | 'normalized_text',
  plain: string,
  ciphertext: string | null,
): Promise<string> {
  if (!ciphertext) return plain
  return decryptTenantValue({ userId, table: 'thought', column, ciphertext })
}

async function readMetadata(
  userId: string,
  row: { metadata: Record<string, unknown> | null; metadataEncrypted: string | null },
): Promise<Record<string, unknown>> {
  if (row.metadataEncrypted) {
    const json = await decryptTenantValue({
      userId,
      table: 'thought',
      column: 'metadata',
      ciphertext: row.metadataEncrypted,
    })
    return JSON.parse(json) as Record<string, unknown>
  }
  return row.metadata ?? {}
}

/**
 * The distinct mention surfaces, in the order they were found. Distinct means the same trimmed
 * string; whether two different strings name the same thing is Jev's question, not a string rule's.
 */
function namesFromSurfaces(surfaces: string[]): CaptureAuditInput['names'] {
  const seen = new Set<string>()
  const names: CaptureAuditInput['names'] = []
  for (const raw of surfaces) {
    const surface = raw.trim()
    if (surface === '' || seen.has(surface)) continue
    seen.add(surface)
    names.push({ ref: `n${names.length + 1}`, surface })
  }
  return names
}

/** The texts a multi-task fan-out split this capture into; none for a child or an unsplit capture. */
function piecesFromMetadata(metadata: Record<string, unknown>): CaptureAuditInput['pieces'] {
  const splitFrom = metadata.splitFrom
  if (typeof splitFrom === 'string' && splitFrom !== '') return []
  const splitInto = metadata.splitInto
  if (splitInto === undefined) return []
  if (
    !Array.isArray(splitInto) ||
    splitInto.some((text) => typeof text !== 'string' || text.trim() === '')
  ) {
    throw new Error('[capture-review] metadata.splitInto must be a list of non-empty texts')
  }
  return (splitInto as string[]).map((text, i) => ({ ref: `p${i + 1}`, text: text.trim() }))
}

/** The audit input for a thought, or null when the thought no longer exists (nothing to audit). */
export async function loadCaptureAuditInput(input: {
  userId: string
  thoughtId: string
}): Promise<CaptureAuditInput | null> {
  const { userId, thoughtId } = input
  const db = getDb()

  const [row] = await db
    .select({
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      createdAt: thought.createdAt,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) return null

  const timezone = (await getUserPreferredTimezone(userId)).trim()
  if (timezone === '') {
    throw new Error('[capture-review] no time zone for the user: the audit cannot place dates')
  }

  const [rawText, storedText, metadata] = await Promise.all([
    decryptText(userId, 'raw_text', row.rawText, row.rawTextEncrypted),
    decryptText(userId, 'normalized_text', row.normalizedText, row.normalizedTextEncrypted),
    readMetadata(userId, row),
  ])

  const surfaceRows = await db
    .select({ surface: entityResolutionLog.mentionSurface })
    .from(entityResolutionLog)
    .where(
      and(eq(entityResolutionLog.userId, userId), eq(entityResolutionLog.thoughtId, thoughtId)),
    )
    .orderBy(asc(entityResolutionLog.createdAt), asc(entityResolutionLog.id))

  const eventRows = await db
    .select({
      semanticSummary: temporalEvent.semanticSummary,
      kind: temporalEvent.kind,
      activePeriod: temporalEvent.activePeriod,
      timePrecision: temporalEvent.timePrecision,
      timezone: temporalEvent.timezone,
      isAllDay: temporalEvent.isAllDay,
      recurrenceRule: temporalEvent.recurrenceRule,
      parseMetadata: temporalEvent.parseMetadata,
    })
    .from(temporalEvent)
    .where(and(eq(temporalEvent.userId, userId), eq(temporalEvent.thoughtId, thoughtId)))
    .orderBy(asc(temporalEvent.startAt), asc(temporalEvent.id))

  return {
    capturedAt: row.createdAt.toISOString(),
    timezone,
    rawText,
    storedText,
    names: namesFromSurfaces(surfaceRows.map((r) => r.surface)),
    dates: eventRows.map((event, i) => ({ ref: `d${i + 1}`, ...describeTemporalEvent(event) })),
    pieces: piecesFromMetadata(metadata),
  }
}
