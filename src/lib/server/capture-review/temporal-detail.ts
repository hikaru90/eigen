/**
 * What Eigen stored for one temporal event, in the words the capture audit's date question uses
 * (docs/planning/capture-feedback.md §4): the stored calendar day, and a plain detail such as
 * "at 09:00", "as the deadline", "every Tuesday at 19:00" or "until Friday 13 November 2026".
 *
 * Deterministic formatting of structured fields only (the stored range, precision, kind, zone and
 * recurrence rule). Nothing here reads the event text or decides what it means: whether the stored
 * time matches the capture is Jev's call.
 */

import { parseActivePeriodLiteral } from '$lib/server/memory/temporal-validity'
import { formatCalendarDay, isoCalendarDay, requireTimeZone, zonedParts } from './calendar'
import { describeRecurrence } from './recurrence'

/** The stored columns of a temporal event this description reads. */
export type TemporalEventAuditRow = {
  semanticSummary: string
  kind: string
  /** Postgres `tsrange` literal, UTC, half-open: `[start,end)`. */
  activePeriod: string
  timePrecision: string
  timezone: string
  isAllDay: boolean
  recurrenceRule: string | null
  /** Extraction output as stored; `endAt` is a string only when the text gave an end. */
  parseMetadata: Record<string, unknown>
}

export type TemporalAuditDate = {
  event: string
  /** Start day in the event's time zone (`YYYY-MM-DD`); null when the event repeats. */
  day: string | null
  /** Extra plain words, or null when there are none. */
  detail: string | null
}

function clock(parts: { hour: number; minute: number }): string {
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

/**
 * True when extraction was given an end for the event. Without one the app pads the range itself
 * (a deadline or reminder gets one day, an exact event one hour, a week or fuzzy window its span),
 * and that padding is not something the capture said, so it is not described.
 */
function textGaveAnEnd(parseMetadata: Record<string, unknown>): boolean {
  const endAt = parseMetadata.endAt
  return typeof endAt === 'string' && !Number.isNaN(Date.parse(endAt))
}

export function describeTemporalEvent(row: TemporalEventAuditRow): TemporalAuditDate {
  const event = row.semanticSummary.trim()
  if (event === '') {
    throw new Error('[capture-review] a stored temporal event has an empty summary')
  }
  requireTimeZone(row.timezone)

  const { start, end } = parseActivePeriodLiteral(row.activePeriod)
  const startLocal = zonedParts(start, row.timezone)
  const rule = row.recurrenceRule?.trim() ?? ''
  const recurrence =
    rule === '' ? null : describeRecurrence({ rule, start, timeZone: row.timezone })

  const words: string[] = []
  if (recurrence) words.push(recurrence.cadence)
  if (row.timePrecision === 'exact' && !row.isAllDay) words.push(`at ${clock(startLocal)}`)
  if (recurrence?.limit) words.push(recurrence.limit)
  if (row.kind === 'deadline') words.push('as the deadline')
  if (!recurrence && textGaveAnEnd(row.parseMetadata)) {
    // The range is half-open: the last day it covers is the day of its last instant.
    const lastLocal = zonedParts(new Date(end.getTime() - 1), row.timezone)
    if (isoCalendarDay(lastLocal) > isoCalendarDay(startLocal)) {
      words.push(`until ${formatCalendarDay(lastLocal)}`)
    }
  }

  return {
    event,
    day: recurrence ? null : isoCalendarDay(startLocal),
    detail: words.length > 0 ? words.join(' ') : null,
  }
}
