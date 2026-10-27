/**
 * Calendar formatting for the capture audit: wall-clock parts of an instant in a time zone, and the
 * plain English day names the audit questions use. Pure arithmetic on numbers and Intl, no I/O, and
 * no judgment about what any text means.
 */

export type CalendarDay = { year: number; month: number; day: number }

export type ZonedParts = CalendarDay & { hour: number; minute: number }

function fail(message: string): never {
  throw new Error(`[capture-review] ${message}`)
}

/** Throws unless `timeZone` is an IANA time zone this runtime knows. Never echoes the value. */
export function requireTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone })
  } catch {
    fail('the event time zone is not a valid IANA time zone')
  }
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const found = parts.find((p) => p.type === type)
  if (!found) fail(`no ${type} in the formatted date`)
  return Number(found.value)
}

/** The wall clock of `instant` in `timeZone` (hour 0..23, midnight is hour 0). */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  requireTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant)
  return {
    year: numberPart(parts, 'year'),
    month: numberPart(parts, 'month'),
    day: numberPart(parts, 'day'),
    hour: numberPart(parts, 'hour'),
    minute: numberPart(parts, 'minute'),
  }
}

/** `YYYY-MM-DD`. */
export function isoCalendarDay(d: CalendarDay): string {
  const mm = String(d.month).padStart(2, '0')
  const dd = String(d.day).padStart(2, '0')
  return `${String(d.year).padStart(4, '0')}-${mm}-${dd}`
}

function noonUtc(d: CalendarDay): Date {
  return new Date(Date.UTC(d.year, d.month - 1, d.day, 12))
}

/** English weekday name of a calendar day (the day has no zone, so UTC noon is exact). */
export function weekdayName(d: CalendarDay): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(noonUtc(d))
}

/** English month name for 1..12. */
export function monthName(month: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long' }).format(
    new Date(Date.UTC(2026, month - 1, 15, 12)),
  )
}

/** "Thursday 31 December 2026": joined here so ICU punctuation cannot vary. */
export function formatCalendarDay(d: CalendarDay): string {
  return `${weekdayName(d)} ${d.day} ${monthName(d.month)} ${d.year}`
}

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st. */
export function ordinalNumber(n: number): string {
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`
  const last = n % 10
  if (last === 1) return `${n}st`
  if (last === 2) return `${n}nd`
  if (last === 3) return `${n}rd`
  return `${n}th`
}

/** True when year-month-day is a real calendar date. */
export function isRealCalendarDay(d: CalendarDay): boolean {
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day))
  return (
    check.getUTCFullYear() === d.year &&
    check.getUTCMonth() === d.month - 1 &&
    check.getUTCDate() === d.day
  )
}
