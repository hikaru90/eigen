/**
 * Absolute date-range bounds for timeline list/stats (shared client + server).
 * Dial presets (Last week / Last month / All time) are resolved locally here.
 * Free-text NL phrases still go through the shared llmChatCompletion parse endpoint.
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

export type TimelineDatePresetId = 'last-week' | 'last-month' | 'all-time'

export type TimelineDatePresetRange = AbsoluteDateRange & { label: string }

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function endOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
}

function rollingUtcWindow(now: Date, daysBack: number): Pick<AbsoluteDateRange, 'from' | 'to'> {
  const from = new Date(now)
  from.setUTCDate(now.getUTCDate() - daysBack)
  return {
    from: startOfUtcDay(from).toISOString(),
    to: endOfUtcDay(now).toISOString(),
  }
}

/**
 * Deterministic dial presets — never call the LLM for these.
 * Historical windows exclude undated tasks; all-time includes them.
 */
export function computePresetAbsoluteRange(
  preset: TimelineDatePresetId,
  now = new Date(),
): TimelineDatePresetRange {
  if (preset === 'all-time') {
    return { from: null, to: null, includeUndated: true, label: 'All time' }
  }
  if (preset === 'last-month') {
    return {
      ...rollingUtcWindow(now, 30),
      includeUndated: false,
      label: 'Last month',
    }
  }
  return {
    ...rollingUtcWindow(now, 7),
    includeUndated: false,
    label: 'Last week',
  }
}

/** User-facing message from POST /api/timeline/parse-date-range failure bodies. */
export function formatParseDateRangeHttpError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown }
    if (typeof parsed.error === 'string' && parsed.error.trim()) return parsed.error.trim()
    if (typeof parsed.message === 'string' && parsed.message.trim()) return parsed.message.trim()
  } catch {
    // Proxy bodies are often plain "Bad Gateway" HTML/text — not JSON.
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'Date parsing is temporarily unavailable. Try Last week / Last month, or try again.'
  }
  const trimmed = bodyText.trim()
  return trimmed || `Request failed (${status})`
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
