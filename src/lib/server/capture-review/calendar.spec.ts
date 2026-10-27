import { describe, expect, it } from 'vitest'
import {
  formatCalendarDay,
  isoCalendarDay,
  ordinalNumber,
  requireTimeZone,
  zonedParts,
} from './calendar'

describe('zonedParts', () => {
  it('reads the wall clock of an instant in the given time zone', () => {
    expect(zonedParts(new Date('2026-11-03T18:00:00.000Z'), 'Europe/Berlin')).toEqual({
      year: 2026,
      month: 11,
      day: 3,
      hour: 19,
      minute: 0,
    })
  })

  it('crosses the day boundary with the zone offset', () => {
    expect(zonedParts(new Date('2026-11-06T23:30:00.000Z'), 'Europe/Berlin')).toMatchObject({
      year: 2026,
      month: 11,
      day: 7,
      hour: 0,
      minute: 30,
    })
    // US clocks went back on 1 November: Los Angeles is UTC-8 on 6 November.
    expect(zonedParts(new Date('2026-11-07T03:30:00.000Z'), 'America/Los_Angeles')).toMatchObject({
      day: 6,
      hour: 19,
      minute: 30,
    })
  })

  it('reads midnight as hour 0, never 24', () => {
    expect(zonedParts(new Date('2026-11-05T23:00:00.000Z'), 'Europe/Berlin')).toMatchObject({
      day: 6,
      hour: 0,
      minute: 0,
    })
  })

  it('follows summer time', () => {
    expect(zonedParts(new Date('2026-07-01T07:00:00.000Z'), 'Europe/Berlin').hour).toBe(9)
  })
})

describe('formatCalendarDay and isoCalendarDay', () => {
  it('writes the weekday, day, month and year in English', () => {
    expect(formatCalendarDay({ year: 2026, month: 12, day: 31 })).toBe('Thursday 31 December 2026')
    expect(formatCalendarDay({ year: 2027, month: 1, day: 1 })).toBe('Friday 1 January 2027')
  })

  it('writes an ISO day with zero padding', () => {
    expect(isoCalendarDay({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07')
  })
})

describe('ordinalNumber', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [30, '30th'],
    [31, '31st'],
  ])('%i is %s', (n, expected) => {
    expect(ordinalNumber(n)).toBe(expected)
  })
})

describe('requireTimeZone', () => {
  it('accepts an IANA name and rejects anything else', () => {
    expect(() => requireTimeZone('Europe/Berlin')).not.toThrow()
    expect(() => requireTimeZone('UTC')).not.toThrow()
    expect(() => requireTimeZone('Mars/Olympus')).toThrow(/time zone/)
    expect(() => requireTimeZone('')).toThrow(/time zone/)
  })
})
