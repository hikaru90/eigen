import { describe, expect, it } from 'vitest'
import { describeTemporalEvent, type TemporalEventAuditRow } from './temporal-detail'

const BERLIN = 'Europe/Berlin'

/** A stored event. Instants are UTC, like the tsrange literal the app writes. */
function row(overrides: Partial<TemporalEventAuditRow> = {}): TemporalEventAuditRow {
  return {
    semanticSummary: 'Dentist appointment',
    kind: 'appointment',
    // Friday 6 November 2026, 09:00-10:00 in Berlin (CET, UTC+1).
    activePeriod: '[2026-11-06T08:00:00.000Z,2026-11-06T09:00:00.000Z)',
    timePrecision: 'exact',
    timezone: BERLIN,
    isAllDay: false,
    recurrenceRule: null,
    parseMetadata: { startAt: '2026-11-06T08:00:00.000Z', endAt: null },
    ...overrides,
  }
}

describe('describeTemporalEvent: the stored day', () => {
  it('names the start day in the event time zone, as YYYY-MM-DD', () => {
    expect(describeTemporalEvent(row())).toMatchObject({
      event: 'Dentist appointment',
      day: '2026-11-06',
    })
  })

  it('moves the day across the time zone boundary (23:30 UTC is already tomorrow in Berlin)', () => {
    const late = row({ activePeriod: '[2026-11-06T23:30:00.000Z,2026-11-07T00:30:00.000Z)' })
    expect(describeTemporalEvent(late)).toMatchObject({ day: '2026-11-07', detail: 'at 00:30' })
    // The same instant is still the 6th in Los Angeles (UTC-8 after the US clocks went back).
    const la = describeTemporalEvent({ ...late, timezone: 'America/Los_Angeles' })
    expect(la).toMatchObject({ day: '2026-11-06', detail: 'at 15:30' })
  })

  it('reads the stored range in the Postgres driver form as well', () => {
    expect(
      describeTemporalEvent(row({ activePeriod: '["2026-11-06 08:00:00","2026-11-06 09:00:00")' })),
    ).toMatchObject({ day: '2026-11-06', detail: 'at 09:00' })
  })

  it('trims the event text', () => {
    expect(describeTemporalEvent(row({ semanticSummary: '  Dentist  ' })).event).toBe('Dentist')
  })
})

describe('describeTemporalEvent: the detail words', () => {
  it('says the clock time when the precision has one and the event is not all-day', () => {
    expect(describeTemporalEvent(row()).detail).toBe('at 09:00')
  })

  it('says nothing about time for an all-day event, even at exact precision', () => {
    const allDay = row({
      activePeriod: '[2026-11-05T23:00:00.000Z,2026-11-06T23:00:00.000Z)',
      isAllDay: true,
    })
    expect(describeTemporalEvent(allDay)).toEqual({
      event: 'Dentist appointment',
      day: '2026-11-06',
      detail: null,
    })
  })

  it('says nothing about time when the precision is coarser than a clock time', () => {
    for (const timePrecision of ['day', 'week', 'month', 'fuzzy']) {
      expect(describeTemporalEvent(row({ timePrecision })).detail).toBeNull()
    }
  })

  it('says "as the deadline" for a deadline, after the time', () => {
    expect(
      describeTemporalEvent(
        row({
          kind: 'deadline',
          activePeriod: '[2026-11-06T16:00:00.000Z,2026-11-07T16:00:00.000Z)',
        }),
      ),
    ).toMatchObject({ day: '2026-11-06', detail: 'at 17:00 as the deadline' })
    expect(describeTemporalEvent(row({ kind: 'deadline', timePrecision: 'day' })).detail).toBe(
      'as the deadline',
    )
  })

  it('does not call the code-made one-day window of a deadline a period', () => {
    // A deadline without an end is stored as start + 1 day: only a stated end is "until".
    const deadline = row({
      kind: 'deadline',
      timePrecision: 'exact',
      activePeriod: '[2026-11-06T16:00:00.000Z,2026-11-07T16:00:00.000Z)',
      parseMetadata: { startAt: '2026-11-06T16:00:00.000Z', endAt: null },
    })
    expect(describeTemporalEvent(deadline).detail).toBe('at 17:00 as the deadline')
  })

  it('says "until" the last day of a period the text gave an end for', () => {
    // Mon 9 Nov 00:00 to Sat 14 Nov 00:00 Berlin (exclusive end): the last day is Friday 13 November.
    const period = row({
      kind: 'period',
      timePrecision: 'day',
      isAllDay: true,
      activePeriod: '[2026-11-08T23:00:00.000Z,2026-11-13T23:00:00.000Z)',
      parseMetadata: { startAt: '2026-11-08T23:00:00.000Z', endAt: '2026-11-13T23:00:00.000Z' },
    })
    expect(describeTemporalEvent(period)).toEqual({
      event: 'Dentist appointment',
      day: '2026-11-09',
      detail: 'until Friday 13 November 2026',
    })
  })

  it('says nothing for a stated end that falls on the start day', () => {
    const sameDay = row({
      parseMetadata: { startAt: '2026-11-06T08:00:00.000Z', endAt: '2026-11-06T09:00:00.000Z' },
    })
    expect(describeTemporalEvent(sameDay).detail).toBe('at 09:00')
  })

  it('does not call a week or a fuzzy window without a stated end a period', () => {
    const week = row({
      timePrecision: 'week',
      activePeriod: '[2026-11-08T23:00:00.000Z,2026-11-15T23:00:00.000Z)',
    })
    expect(describeTemporalEvent(week)).toMatchObject({ day: '2026-11-09', detail: null })
  })

  it('puts the period end last, after the time and the deadline words', () => {
    const all = row({
      kind: 'deadline',
      activePeriod: '[2026-11-09T16:00:00.000Z,2026-11-13T16:00:00.000Z)',
      parseMetadata: { startAt: '2026-11-09T16:00:00.000Z', endAt: '2026-11-13T16:00:00.000Z' },
    })
    expect(describeTemporalEvent(all).detail).toBe(
      'at 17:00 as the deadline until Friday 13 November 2026',
    )
  })

  it('ignores a stated end it cannot read as a date', () => {
    const odd = row({
      activePeriod: '[2026-11-09T16:00:00.000Z,2026-11-13T16:00:00.000Z)',
      parseMetadata: { startAt: 'x', endAt: 'someday' },
    })
    expect(describeTemporalEvent(odd).detail).toBe('at 17:00')
  })
})

describe('describeTemporalEvent: repeating events', () => {
  const weekly = row({
    // Tuesday 3 November 2026, 19:00 Berlin.
    activePeriod: '[2026-11-03T18:00:00.000Z,2026-11-03T19:00:00.000Z)',
    recurrenceRule: 'FREQ=WEEKLY',
    kind: 'reminder',
  })

  it('has no day and describes the repeat with its time', () => {
    expect(describeTemporalEvent(weekly)).toEqual({
      event: 'Dentist appointment',
      day: null,
      detail: 'every Tuesday at 19:00',
    })
  })

  it('leaves the time out when the precision has none', () => {
    expect(describeTemporalEvent({ ...weekly, timePrecision: 'day' }).detail).toBe('every Tuesday')
  })

  it('puts the repeat limit after the time', () => {
    expect(describeTemporalEvent({ ...weekly, recurrenceRule: 'FREQ=WEEKLY;COUNT=4' }).detail).toBe(
      'every Tuesday at 19:00 for 4 occurrences',
    )
    expect(
      describeTemporalEvent({ ...weekly, recurrenceRule: 'FREQ=WEEKLY;UNTIL=20261231' }).detail,
    ).toBe('every Tuesday at 19:00 until Thursday 31 December 2026')
  })

  it('does not add a period end to a repeating event', () => {
    const repeating = {
      ...weekly,
      parseMetadata: { startAt: '2026-11-03T18:00:00.000Z', endAt: '2026-11-10T18:00:00.000Z' },
    }
    expect(describeTemporalEvent(repeating).detail).toBe('every Tuesday at 19:00')
  })

  it('treats a blank rule as no repeat', () => {
    expect(describeTemporalEvent({ ...weekly, recurrenceRule: '  ' })).toMatchObject({
      day: '2026-11-03',
    })
  })

  it('fails loudly on a rule it cannot express', () => {
    expect(() =>
      describeTemporalEvent({ ...weekly, recurrenceRule: 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1' }),
    ).toThrow(/BYSETPOS/)
  })
})

describe('describeTemporalEvent: bad rows fail loudly', () => {
  it('rejects an empty event text', () => {
    expect(() => describeTemporalEvent(row({ semanticSummary: '  ' }))).toThrow(/summary/)
  })

  it('rejects a time zone it does not know', () => {
    expect(() => describeTemporalEvent(row({ timezone: 'Mars/Olympus' }))).toThrow(/time zone/)
  })

  it('rejects a stored range it cannot read', () => {
    expect(() => describeTemporalEvent(row({ activePeriod: 'empty' }))).toThrow(/tsrange/)
  })
})
