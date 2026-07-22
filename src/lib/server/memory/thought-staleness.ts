/**
 * Staleness and salience-exemption rules for thoughts.
 *
 * Some thoughts should never be flagged stale or decay in salience recompute.
 */

import type { MemoryType } from '$lib/server/db/brain.schema'

/** Metadata key: set `true` to exempt a thought from age-based staleness. */
export const NEVER_STALE_METADATA_KEY = 'neverStale'

/** Memory types that represent durable knowledge — age alone does not make them stale. */
export const NEVER_STALE_MEMORY_TYPES: ReadonlySet<MemoryType> = new Set([
  'fact',
  'decision',
  'preference',
])

/** Memory types exempt from time-based salience decay during consolidation. */
export const SALIENCE_EXEMPT_MEMORY_TYPES: ReadonlySet<MemoryType> = NEVER_STALE_MEMORY_TYPES

export function isThoughtNeverStale(input: {
  memoryType?: MemoryType | null
  metadata?: Record<string, unknown> | null
}): boolean {
  if (input.metadata?.[NEVER_STALE_METADATA_KEY] === true) return true
  if (input.memoryType && NEVER_STALE_MEMORY_TYPES.has(input.memoryType)) return true
  return false
}

export function isThoughtSalienceExempt(input: {
  memoryType?: MemoryType | null
  metadata?: Record<string, unknown> | null
}): boolean {
  return isThoughtNeverStale(input)
}

/** Age-based staleness for Q&A context — skipped when {@link isThoughtNeverStale}. */
export function isThoughtStaleByAge(input: {
  createdAt: Date
  now: Date
  thresholdMs: number
  memoryType?: MemoryType | null
  metadata?: Record<string, unknown> | null
}): boolean {
  if (isThoughtNeverStale(input)) return false
  return input.now.getTime() - input.createdAt.getTime() > input.thresholdMs
}
