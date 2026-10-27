/**
 * Plain English for a stored recurrence rule, for the capture audit's date question
 * (docs/planning/capture-feedback.md §4): "every Tuesday", "every 2 weeks on Monday and Wednesday".
 *
 * Deterministic formatting of structured fields only. It expresses the RRULE subset the app uses:
 * the week view expands FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL, COUNT, UNTIL and BYDAY
 * (`$lib/graph/temporal-rrule`), and the extraction prompt asks the chat model for "an iCal RRULE
 * string" with no further limits, so yearly rules and the month-day forms are expressed too.
 * Anything else (HOURLY, BYSETPOS, WKST, BYHOUR, several month days, ...) throws: the audit never
 * guesses what a rule it cannot read means.
 */

import {
  formatCalendarDay,
  isRealCalendarDay,
  monthName,
  ordinalNumber,
  requireTimeZone,
  weekdayName,
  zonedParts,
  type CalendarDay,
} from './calendar'

export type RecurrenceDescription = {
  /** "every Tuesday", "every 2 months on the 3rd". */
  cadence: string
  /** "for 4 occurrences", "until Thursday 31 December 2026"; null when it repeats without end. */
  limit: string | null
}

function fail(message: string): never {
  throw new Error(`[capture-review] recurrence rule ${message}`)
}

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
type WeekdayCode = (typeof WEEKDAY_CODES)[number]

const WEEKDAY_NAME: Record<WeekdayCode, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

const ORDINAL_WORD: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
}

const SUPPORTED_PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'COUNT',
  'UNTIL',
])
const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
type Frequency = (typeof FREQUENCIES)[number]

type ByDay = { ordinal: number | null; code: WeekdayCode }

type Parsed = {
  freq: Frequency
  interval: number
  byDay: ByDay[] | null
  byMonthDay: number | null
  byMonth: number | null
  count: number | null
  until: string | null
}

/** A key that is safe to repeat in an error message: a short upper-case word, never free text. */
function safeKey(key: string): string {
  return /^[A-Z]{1,20}$/.test(key) ? key : 'a part'
}

function splitParts(raw: string): Map<string, string> {
  const body = raw.trim().replace(/^RRULE:/i, '')
  if (body.trim() === '') fail('is empty')
  const parts = new Map<string, string>()
  for (const segment of body.split(';')) {
    const at = segment.indexOf('=')
    if (at <= 0 || at === segment.length - 1) fail('has an empty or malformed segment')
    const key = segment.slice(0, at).trim().toUpperCase()
    const value = segment.slice(at + 1).trim()
    if (value === '') fail('has an empty or malformed segment')
    if (parts.has(key)) fail(`repeats ${safeKey(key)} twice`)
    if (!SUPPORTED_PARTS.has(key)) fail(`uses ${safeKey(key)}, which the audit cannot express`)
    parts.set(key, value)
  }
  return parts
}

function positiveInt(value: string, name: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) fail(`${name} must be a positive whole number`)
  return Number(value)
}

function parseByDay(value: string): ByDay[] {
  return value.split(',').map((token) => {
    const match = /^(-?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/i.exec(token.trim())
    if (!match) fail('has a BYDAY value it cannot read')
    return {
      ordinal: match[1] === undefined ? null : Number(match[1]),
      code: match[2].toUpperCase() as WeekdayCode,
    }
  })
}

function parseMonthDay(value: string): number {
  if (!/^-?\d{1,2}$/.test(value))
    fail('has a BYMONTHDAY it cannot read (several days are not supported)')
  const n = Number(value)
  if (!((n >= 1 && n <= 31) || n === -1)) fail('has a BYMONTHDAY outside 1..31 and -1')
  return n
}

function parseMonth(value: string): number {
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 12) {
    fail('has a BYMONTH outside 1..12')
  }
  return Number(value)
}

function parse(raw: string): Parsed {
  const parts = splitParts(raw)

  const freqRaw = parts.get('FREQ')?.toUpperCase()
  if (freqRaw === undefined) fail('has no FREQ')
  if (!(FREQUENCIES as readonly string[]).includes(freqRaw)) {
    fail('has a FREQ outside DAILY, WEEKLY, MONTHLY and YEARLY')
  }
  const freq = freqRaw as Frequency

  const interval = parts.has('INTERVAL') ? positiveInt(parts.get('INTERVAL')!, 'INTERVAL') : 1
  const count = parts.has('COUNT') ? positiveInt(parts.get('COUNT')!, 'COUNT') : null
  const until = parts.get('UNTIL') ?? null
  if (count !== null && until !== null) fail('has both COUNT and UNTIL')

  const byDay = parts.has('BYDAY') ? parseByDay(parts.get('BYDAY')!) : null
  const byMonthDay = parts.has('BYMONTHDAY') ? parseMonthDay(parts.get('BYMONTHDAY')!) : null
  const byMonth = parts.has('BYMONTH') ? parseMonth(parts.get('BYMONTH')!) : null

  if (freq === 'DAILY' || freq === 'WEEKLY') {
    if (byMonthDay !== null) fail(`has BYMONTHDAY on a ${freq.toLowerCase()} rule`)
    if (byMonth !== null) fail(`has BYMONTH on a ${freq.toLowerCase()} rule`)
    if (byDay?.some((d) => d.ordinal !== null)) {
      fail(`has an ordinal BYDAY on a ${freq.toLowerCase()} rule`)
    }
    if (freq === 'DAILY' && byDay !== null && interval !== 1) {
      fail('combines INTERVAL with a BYDAY filter on a daily rule')
    }
  } else if (freq === 'MONTHLY') {
    if (byMonth !== null) fail('has BYMONTH on a monthly rule')
    if (byDay !== null) {
      if (byMonthDay !== null) fail('has both BYDAY and BYMONTHDAY on a monthly rule')
      if (byDay.length !== 1 || byDay[0].ordinal === null || !(byDay[0].ordinal in ORDINAL_WORD)) {
        fail('has a BYDAY on a monthly rule that is not one first..fourth or last weekday')
      }
    }
  } else {
    if (byDay !== null) fail('has BYDAY on a yearly rule')
  }

  return { freq, interval, byDay, byMonthDay, byMonth, count, until }
}

function joinList(items: string[]): string {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function isMondayToFriday(codes: WeekdayCode[]): boolean {
  return codes.length === 5 && codes.every((c) => ['MO', 'TU', 'WE', 'TH', 'FR'].includes(c))
}

/** The plain weekdays of a BYDAY, in week order without repeats. */
function sortedWeekdays(byDay: ByDay[]): WeekdayCode[] {
  const wanted = new Set(byDay.map((d) => d.code))
  return WEEKDAY_CODES.filter((code) => wanted.has(code))
}

function plural(n: number, unit: string): string {
  return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`
}

function describeLimit(parsed: Parsed, timeZone: string): string | null {
  if (parsed.count !== null) {
    return `for ${parsed.count} ${parsed.count === 1 ? 'occurrence' : 'occurrences'}`
  }
  if (parsed.until === null) return null
  return `until ${formatCalendarDay(untilDay(parsed.until, timeZone))}`
}

/** The calendar day an UNTIL value falls on: a date, a floating date-time, or a UTC date-time. */
function untilDay(value: string, timeZone: string): CalendarDay {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/i.exec(value)
  if (!match) fail('has an UNTIL it cannot read')
  const day: CalendarDay = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }
  if (!isRealCalendarDay(day)) fail('has an UNTIL that is not a real date')
  if (match[4] === undefined || match[7] === undefined) return day
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  if (hour > 23 || minute > 59 || second > 60) fail('has an UNTIL that is not a real time')
  const instant = new Date(Date.UTC(day.year, day.month - 1, day.day, hour, minute, second))
  const local = zonedParts(instant, timeZone)
  return { year: local.year, month: local.month, day: local.day }
}

/**
 * Describes a recurrence rule in plain English. `start` (the event's first occurrence) and
 * `timeZone` supply what the rule leaves to DTSTART: the weekday of a weekly rule, the day of the
 * month of a monthly one, the date of a yearly one.
 */
export function describeRecurrence(input: {
  rule: string
  start: Date
  timeZone: string
}): RecurrenceDescription {
  requireTimeZone(input.timeZone)
  const parsed = parse(input.rule)
  const startDay = zonedParts(input.start, input.timeZone)
  const limit = describeLimit(parsed, input.timeZone)

  switch (parsed.freq) {
    case 'DAILY': {
      if (parsed.byDay === null) return { cadence: plural(parsed.interval, 'day'), limit }
      const codes = sortedWeekdays(parsed.byDay)
      return {
        cadence: isMondayToFriday(codes)
          ? 'every weekday'
          : `every ${joinList(codes.map((c) => WEEKDAY_NAME[c]))}`,
        limit,
      }
    }
    case 'WEEKLY': {
      const names =
        parsed.byDay === null
          ? [weekdayName(startDay)]
          : sortedWeekdays(parsed.byDay).map((c) => WEEKDAY_NAME[c])
      const weekdays = parsed.byDay !== null && isMondayToFriday(sortedWeekdays(parsed.byDay))
      if (parsed.interval === 1) {
        return { cadence: weekdays ? 'every weekday' : `every ${joinList(names)}`, limit }
      }
      return {
        cadence: `${plural(parsed.interval, 'week')} on ${weekdays ? 'weekdays' : joinList(names)}`,
        limit,
      }
    }
    case 'MONTHLY': {
      const every = plural(parsed.interval, 'month')
      if (parsed.byDay !== null) {
        const { ordinal, code } = parsed.byDay[0]
        return { cadence: `${every} on the ${ORDINAL_WORD[ordinal!]} ${WEEKDAY_NAME[code]}`, limit }
      }
      const monthDay = parsed.byMonthDay ?? startDay.day
      const day = monthDay === -1 ? 'last day' : ordinalNumber(monthDay)
      return { cadence: `${every} on the ${day}`, limit }
    }
    case 'YEARLY': {
      const month = parsed.byMonth ?? startDay.month
      const day = parsed.byMonthDay ?? startDay.day
      const dayText = day === -1 ? 'the last day of' : String(day)
      return {
        cadence: `${plural(parsed.interval, 'year')} on ${dayText} ${monthName(month)}`,
        limit,
      }
    }
  }
}
