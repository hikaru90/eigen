/**
 * Staleness and salience-exemption rules for thoughts.
 *
 * Single type axis: durability derives from the thought's ontology category
 * (`ontology_entity_kind.never_stale`, loaded per user) plus the explicit
 * `metadata.neverStale` escape hatch. There is no memoryType field anymore.
 */

/** Metadata key: set `true` to exempt a thought from age-based staleness. */
export const NEVER_STALE_METADATA_KEY = 'neverStale'

export type ThoughtStalenessInput = {
  /** The thought's ontology thought_category key. */
  category: string | null
  /** Category keys whose ontology kind is durable (`never_stale`). Loaded per user per operation. */
  neverStaleCategories: ReadonlySet<string>
  metadata?: Record<string, unknown> | null
}

export function isThoughtNeverStale(input: ThoughtStalenessInput): boolean {
  if (input.metadata?.[NEVER_STALE_METADATA_KEY] === true) return true
  if (input.category && input.neverStaleCategories.has(input.category)) return true
  return false
}

export function isThoughtSalienceExempt(input: ThoughtStalenessInput): boolean {
  return isThoughtNeverStale(input)
}

/** Age-based staleness for Q&A context — skipped when {@link isThoughtNeverStale}. */
export function isThoughtStaleByAge(
  input: ThoughtStalenessInput & {
    createdAt: Date
    now: Date
    thresholdMs: number
  },
): boolean {
  if (isThoughtNeverStale(input)) return false
  return input.now.getTime() - input.createdAt.getTime() > input.thresholdMs
}

