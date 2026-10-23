import { describe, expect, it } from 'vitest'
import {
  FRESH_WINDOW_MS,
  capitalizeFirst,
  dayLabelFor,
  dayNumberInZone,
  groupThoughtsByDay,
  isFreshThought,
  timeOfDayLabel,
} from './day-groups'

/**
 * ei app.js:44-52 day labels, ported as a pure module for the Yarn journal
 * (docs/planning/ei-redesign.md, wave 2.2). Timezone-aware so SSR and client
 * agree: the caller injects the user's preferred timezone (settings
 * preferred_timezone via getUserPreferredTimezone) — not the server's local zone.
 *
 * Today/Yesterday labels are injected strings (the page derives them from
 * Intl.RelativeTimeFormat(locale, { numeric: 'auto' }) — locale data, so no
 * new paraglide keys); weekday and date labels come straight from Intl.
 */

// 2026-10-20 is a Tuesday. 14:00 in Europe/Berlin (UTC+2 until Oct 25, 2026).
const NOW_MS = Date.parse('2026-10-20T12:00:00Z')
const BERLIN = 'Europe/Berlin'

const dayOpts = (over: Partial<Parameters<typeof dayLabelFor>[1]> = {}) => ({
  locale: 'en',
  timeZone: BERLIN,
  nowMs: NOW_MS,
  todayLabel: 'today',
  yesterdayLabel: 'yesterday',
  ...over,
})

describe('dayNumberInZone', () => {
  it('counts local days, not UTC days', () => {
    // 23:30Z is already the next day in Berlin (UTC+2).
    const utcDay = dayNumberInZone('2026-10-20T23:30:00Z', 'UTC')
    const berlinDay = dayNumberInZone('2026-10-20T23:30:00Z', BERLIN)
    expect(berlinDay - utcDay).toBe(1)
  })

  it('gives the same day number for instants on the same local day', () => {
    expect(dayNumberInZone('2026-10-20T00:30:00Z', BERLIN)).toBe(
      dayNumberInZone('2026-10-20T12:00:00Z', BERLIN),
    )
  })

  it('rejects unparsable input instead of guessing (no fallbacks)', () => {
    expect(() => dayNumberInZone('not-a-date', BERLIN)).toThrow()
  })
})

describe('dayLabelFor (ei app.js:46-52)', () => {
  it('labels today and yesterday with the injected strings, capitalized', () => {
    expect(dayLabelFor('2026-10-20T09:00:00Z', dayOpts())).toBe('Today')
    expect(dayLabelFor('2026-10-19T09:00:00Z', dayOpts())).toBe('Yesterday')
  })

  it('labels a future-dated row (clock skew) as today, like ei (n <= 0)', () => {
    expect(dayLabelFor('2026-10-21T09:00:00Z', dayOpts())).toBe('Today')
  })

  it('labels the last week by weekday name via Intl', () => {
    // 3 days back — Saturday; 6 days back — Wednesday.
    expect(dayLabelFor('2026-10-17T09:00:00Z', dayOpts())).toBe('Saturday')
    expect(dayLabelFor('2026-10-14T09:00:00Z', dayOpts())).toBe('Wednesday')
  })

  it('labels older rows by day and month via Intl, in the requested locale', () => {
    expect(dayLabelFor('2026-10-13T09:00:00Z', dayOpts())).toBe('October 13')
    expect(dayLabelFor('2026-09-14T09:00:00Z', dayOpts())).toBe('September 14')
    expect(dayLabelFor('2026-10-13T09:00:00Z', dayOpts({ locale: 'de' }))).toBe('13. Oktober')
  })

  it('respects the timezone for the day boundary (23:30Z is tomorrow in Berlin)', () => {
    // In Berlin that instant is Oct 21 — the future — so it reads as Today.
    expect(dayLabelFor('2026-10-20T23:30:00Z', dayOpts())).toBe('Today')
    // In New York (UTC-4) it is still Oct 20, 19:30 — today as well.
    expect(dayLabelFor('2026-10-20T23:30:00Z', dayOpts({ timeZone: 'America/New_York' }))).toBe(
      'Today',
    )
  })
})

describe('timeOfDayLabel', () => {
  it('formats the local clock time in the user timezone', () => {
    expect(timeOfDayLabel('2026-10-20T09:05:00Z', { locale: 'en-GB', timeZone: BERLIN })).toBe(
      '11:05',
    )
    expect(
      timeOfDayLabel('2026-10-20T09:05:00Z', { locale: 'en-GB', timeZone: 'America/New_York' }),
    ).toBe('05:05')
    expect(timeOfDayLabel('2026-10-20T14:05:00Z', { locale: 'de', timeZone: BERLIN })).toBe('16:05')
  })
})

describe('groupThoughtsByDay (ei app.js:743-757)', () => {
  type Row = { id: string; createdAtIso: string }

  const row = (id: string, createdAtIso: string): Row => ({ id, createdAtIso })

  it('returns an empty list for an empty strand', () => {
    expect(groupThoughtsByDay([], dayOpts())).toEqual([])
  })

  it('sorts newest first even when handed an unsorted strand', () => {
    const groups = groupThoughtsByDay(
      [row('old', '2026-10-15T10:00:00Z'), row('new', '2026-10-20T10:00:00Z')],
      dayOpts(),
    )
    expect(groups.map((g) => g.items.map((r) => r.id))).toEqual([['new'], ['old']])
  })

  it('groups same-day thoughts under one day head', () => {
    const groups = groupThoughtsByDay(
      [
        row('a', '2026-10-20T11:00:00Z'),
        row('b', '2026-10-20T08:00:00Z'),
        row('c', '2026-10-19T08:00:00Z'),
      ],
      dayOpts(),
    )
    expect(groups).toHaveLength(2)
    expect(groups[0]?.label).toBe('Today')
    expect(groups[0]?.items.map((r) => r.id)).toEqual(['a', 'b'])
    expect(groups[1]?.label).toBe('Yesterday')
    expect(groups[1]?.items.map((r) => r.id)).toEqual(['c'])
  })

  it('gives consecutive groups their own weekday/date labels', () => {
    const groups = groupThoughtsByDay(
      [
        row('a', '2026-10-20T09:00:00Z'), // Tuesday  (today)
        row('b', '2026-10-18T09:00:00Z'), // Sunday
        row('c', '2026-10-13T09:00:00Z'), // 7 days back — date label
      ],
      dayOpts(),
    )
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Sunday', 'October 13'])
  })

  it('splits same-weekday rows a week apart into their own groups', () => {
    const groups = groupThoughtsByDay(
      [
        row('a', '2026-10-14T09:00:00Z'), // Wednesday, 6 days back
        row('b', '2026-10-07T09:00:00Z'), // Wednesday, 13 days back — same weekday, own group
      ],
      dayOpts(),
    )
    expect(groups.map((g) => g.label)).toEqual(['Wednesday', 'October 7'])
  })
})

describe('fresh signal dot', () => {
  it('marks a just-captured thought fresh within the window', () => {
    const created = NOW_MS - FRESH_WINDOW_MS + 1_000
    expect(isFreshThought(new Date(created).toISOString(), NOW_MS)).toBe(true)
  })

  it('stops marking a thought fresh once the window has passed', () => {
    const created = NOW_MS - FRESH_WINDOW_MS - 1_000
    expect(isFreshThought(new Date(created).toISOString(), NOW_MS)).toBe(false)
  })

  it('treats a future timestamp (clock skew) as fresh', () => {
    const created = NOW_MS + 30_000
    expect(isFreshThought(new Date(created).toISOString(), NOW_MS)).toBe(true)
  })

  it('rejects unparsable input instead of staying quiet (no fallbacks)', () => {
    expect(() => isFreshThought('garbage', NOW_MS)).toThrow()
  })
})

describe('capitalizeFirst (label formatting only)', () => {
  it('capitalizes the first letter and leaves the rest alone', () => {
    expect(capitalizeFirst('today')).toBe('Today')
    expect(capitalizeFirst('heute')).toBe('Heute')
    expect(capitalizeFirst('')).toBe('')
  })
})
