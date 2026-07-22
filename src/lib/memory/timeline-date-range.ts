/**
 * Absolute date-range bounds for timeline list/stats (shared client + server).
 * Semantic NL phrases are resolved by the LLM parse endpoint — not here.
 */

export const RELEVANT_LOOKAHEAD_DAYS = 7

export type AbsoluteDateRange = {
  /** Inclusive lower bound ISO datetime, or null for unbounded. */
  from: string | null
  /** Inclusive upper bound ISO datetime, or null for unbounded. */
  to: string | null
  /** When true, undated task rows are included in the result set. */
  includeUndated: boolean
}

/** Deterministic default window matching legacy `relevant` semantics (no LLM). */
export function computeRelevantAbsoluteRange(now = new Date()): AbsoluteDateRange {
  const to = new Date(now.getTime() + RELEVANT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000)
  return {
    from: now.toISOString(),
    to: to.toISOString(),
    includeUndated: true,
  }
}

export function itemOverlapsAbsoluteRange(
  item: { startAt: string | null; endAt: string | null; createdAt: string },
  range: AbsoluteDateRange,
): boolean {
  if (!item.startAt && !item.endAt) {
    return range.includeUndated
  }
  const startMs = new Date(item.startAt ?? item.endAt ?? item.createdAt).getTime()
  const endMs = new Date(item.endAt ?? item.startAt ?? item.createdAt).getTime()
  if (range.from) {
    const fromMs = new Date(range.from).getTime()
    if (endMs < fromMs) return false
  }
  if (range.to) {
    const toMs = new Date(range.to).getTime()
    if (startMs > toMs) return false
  }
  return true
}
