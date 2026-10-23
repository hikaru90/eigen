/**
 * Day grouping for the Yarn journal (ei redesign, wave 2.2) — a port of ei
 * app.js:44-52 (`dayDiff` / `dayLabel` / `clock`) as pure, timezone-aware
 * functions. The caller injects the user's preferred timezone and locale so
 * SSR and client agree; labels come from Intl (locale data) plus the two
 * injected relative-day strings the page derives from
 * Intl.RelativeTimeFormat(locale, { numeric: 'auto' }) — no hardcoded copy.
 *
 * Pure formatting and grouping only: nothing here decides meaning.
 */

export type DayGroupOptions = {
  locale: string
  timeZone: string
  nowMs: number
  todayLabel: string
  yesterdayLabel: string
}

export type TimeLabelOptions = {
  locale: string
  timeZone: string
}

export type DayGroup<T> = {
  label: string
  items: T[]
}

/** A freshly captured thought carries its signal dot for this long. */
export const FRESH_WINDOW_MS = 120_000

const MS_PER_DAY = 86_400_000

/** Days-since-epoch for an ISO instant, anchored to local midnights in `timeZone`. */
export function dayNumberInZone(iso: string, timeZone: string): number {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`day-groups: invalid ISO date: ${iso}`)
  }
  // en-CA formats as YYYY-MM-DD regardless of the user's locale.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
  const [year, month, day] = ymd.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}

/** ei app.js:46-52 — Today / Yesterday / weekday (< 7 days) / day + month. */
export function dayLabelFor(iso: string, opts: DayGroupOptions): string {
  const diff = dayNumberInZone(new Date(opts.nowMs).toISOString(), opts.timeZone) - dayNumberInZone(iso, opts.timeZone)
  if (diff <= 0) return capitalizeFirst(opts.todayLabel)
  if (diff === 1) return capitalizeFirst(opts.yesterdayLabel)
  const date = new Date(iso)
  if (diff < 7) {
    return new Intl.DateTimeFormat(opts.locale, { timeZone: opts.timeZone, weekday: 'long' }).format(date)
  }
  return new Intl.DateTimeFormat(opts.locale, {
    timeZone: opts.timeZone,
    day: 'numeric',
    month: 'long',
  }).format(date)
}

/** ei app.js:45 — the row's local clock time (HH:MM, locale numerals). */
export function timeOfDayLabel(iso: string, opts: TimeLabelOptions): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`day-groups: invalid ISO date: ${iso}`)
  }
  return new Intl.DateTimeFormat(opts.locale, {
    timeZone: opts.timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * ei app.js:743-757 — fold a strand of thoughts into consecutive day groups,
 * newest first. Grouping is by day number in the user's timezone (so same
 * weekday a week apart never merges), labels come from the group's newest row.
 * Input order does not matter; within a group, order is newest first.
 */
export function groupThoughtsByDay<T extends { createdAtIso: string }>(
  items: readonly T[],
  opts: DayGroupOptions,
): DayGroup<T>[] {
  const sorted = [...items].sort(
    (a, b) => Date.parse(b.createdAtIso) - Date.parse(a.createdAtIso),
  )
  const groups: { dayNumber: number; label: string; items: T[] }[] = []
  let current: { dayNumber: number; label: string; items: T[] } | null = null
  for (const item of sorted) {
    const dayNumber = dayNumberInZone(item.createdAtIso, opts.timeZone)
    if (!current || current.dayNumber !== dayNumber) {
      current = { dayNumber, label: dayLabelFor(item.createdAtIso, opts), items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
}

/** The fresh signal dot: lit for a thought captured within the window. */
export function isFreshThought(createdAtIso: string, nowMs: number): boolean {
  const created = Date.parse(createdAtIso)
  if (Number.isNaN(created)) {
    throw new Error(`day-groups: invalid ISO date: ${createdAtIso}`)
  }
  return nowMs - created < FRESH_WINDOW_MS
}

/** 'today' -> 'Today' — presentation capitalization of a locale label. */
export function capitalizeFirst(label: string): string {
  if (label.length === 0) return label
  return label.charAt(0).toUpperCase() + label.slice(1)
}
