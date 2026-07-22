/**
 * Deterministic calendar math for LLM-extracted relative temporal specs.
 * The LLM labels the phrase and structured offset; code computes the instant.
 */

export type WeekdayName =
  'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

export type TemporalRelativeSpec = {
  /** When "capture_time", offsets below are resolved against thought capture time. */
  dateAnchor?: 'capture_time' | 'explicit'
  relativeMonthsPast?: number
  relativeWeeksPast?: number
  relativeDaysPast?: number
  lastWeekdayBeforeCapture?: WeekdayName
  /** Explicit calendar date YYYY-MM-DD from text (e.g. March 15th, February 20). */
  calendarDate?: string
  /** Month number 1-12 when only month+part is stated (e.g. mid-February). */
  calendarMonth?: number
  calendarMonthPart?: 'start' | 'mid' | 'end'
}

const WEEKDAY_INDEX: Record<WeekdayName, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function utcDateOnly(anchor: Date): Date {
  return new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate(), 12, 0, 0),
  )
}

export function subtractCalendarMonths(anchor: Date, months: number): Date {
  const d = utcDateOnly(anchor)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d
}

export function subtractCalendarDays(anchor: Date, days: number): Date {
  const d = utcDateOnly(anchor)
  d.setUTCDate(d.getUTCDate() - days)
  return d
}

/** Most recent weekday strictly before the anchor calendar day (or 7 days back if same weekday). */
export function previousWeekdayBeforeCapture(anchor: Date, weekday: WeekdayName): Date {
  const d = utcDateOnly(anchor)
  const target = WEEKDAY_INDEX[weekday]
  const current = d.getUTCDay()
  let delta = (current - target + 7) % 7
  if (delta === 0) delta = 7
  d.setUTCDate(d.getUTCDate() - delta)
  return d
}

export function parseCalendarDateOnly(value: string): Date | null {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const d = new Date(Date.UTC(year, month, day, 12, 0, 0))
  if (Number.isNaN(d.getTime())) return null
  return d
}

function calendarMonthAnchor(
  anchor: Date,
  month: number,
  part: 'start' | 'mid' | 'end',
): Date | null {
  if (month < 1 || month > 12) return null
  const year = anchor.getUTCFullYear()
  const day = part === 'start' ? 1 : part === 'mid' ? 15 : 28
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

export function resolveAnchoredStartAt(input: {
  startAt: string
  capturedAt: Date
  relativeSpec?: TemporalRelativeSpec | null
}): Date {
  const spec = input.relativeSpec
  if (spec?.calendarDate) {
    const explicit = parseCalendarDateOnly(spec.calendarDate)
    if (explicit) return explicit
  }

  if (spec?.calendarMonth && spec.calendarMonthPart) {
    const monthAnchor = calendarMonthAnchor(
      input.capturedAt,
      spec.calendarMonth,
      spec.calendarMonthPart,
    )
    if (monthAnchor) return monthAnchor
  }

  if (spec?.dateAnchor === 'capture_time') {
    if (typeof spec.relativeMonthsPast === 'number' && spec.relativeMonthsPast >= 0) {
      return subtractCalendarMonths(input.capturedAt, spec.relativeMonthsPast)
    }
    if (typeof spec.relativeWeeksPast === 'number' && spec.relativeWeeksPast >= 0) {
      return subtractCalendarDays(input.capturedAt, spec.relativeWeeksPast * 7)
    }
    if (typeof spec.relativeDaysPast === 'number' && spec.relativeDaysPast >= 0) {
      return subtractCalendarDays(input.capturedAt, spec.relativeDaysPast)
    }
    if (spec.lastWeekdayBeforeCapture) {
      return previousWeekdayBeforeCapture(input.capturedAt, spec.lastWeekdayBeforeCapture)
    }
  }

  const fallback = new Date(input.startAt)
  if (Number.isNaN(fallback.getTime())) {
    throw new Error(`Invalid temporal startAt: ${input.startAt}`)
  }
  return fallback
}

export function parseRelativeSpec(raw: unknown): TemporalRelativeSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const spec: TemporalRelativeSpec = {}

  const dateAnchor = obj.dateAnchor
  if (dateAnchor === 'capture_time' || dateAnchor === 'explicit') {
    spec.dateAnchor = dateAnchor
  }

  for (const key of ['relativeMonthsPast', 'relativeWeeksPast', 'relativeDaysPast'] as const) {
    const v = obj[key]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      spec[key] = Math.floor(v)
    }
  }

  const weekday = obj.lastWeekdayBeforeCapture
  if (typeof weekday === 'string' && weekday.toLowerCase() in WEEKDAY_INDEX) {
    spec.lastWeekdayBeforeCapture = weekday.toLowerCase() as WeekdayName
  }

  const calendarDate = obj.calendarDate
  if (typeof calendarDate === 'string' && calendarDate.trim()) {
    spec.calendarDate = calendarDate.trim()
  }

  const calendarMonth = obj.calendarMonth
  if (typeof calendarMonth === 'number' && calendarMonth >= 1 && calendarMonth <= 12) {
    spec.calendarMonth = Math.floor(calendarMonth)
  }

  const part = obj.calendarMonthPart
  if (part === 'start' || part === 'mid' || part === 'end') {
    spec.calendarMonthPart = part
  }

  if (Object.keys(spec).length === 0) return undefined
  return spec
}
