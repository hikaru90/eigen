import { describe, expect, it } from 'vitest'
import {
  previousWeekdayBeforeCapture,
  resolveAnchoredStartAt,
  subtractCalendarMonths,
} from './temporal-relative-resolve'

describe('subtractCalendarMonths', () => {
  it('two months before 2023-05-28 → ~2023-03-28', () => {
    const anchor = new Date('2023-05-28T07:17:00.000Z')
    const result = subtractCalendarMonths(anchor, 2)
    expect(result.toISOString().slice(0, 10)).toBe('2023-03-28')
  })
})

describe('previousWeekdayBeforeCapture', () => {
  it('last Saturday from Sunday 2023-05-28 → 2023-05-27', () => {
    const anchor = new Date('2023-05-28T21:04:00.000Z')
    const result = previousWeekdayBeforeCapture(anchor, 'saturday')
    expect(result.toISOString().slice(0, 10)).toBe('2023-05-27')
  })
})

describe('resolveAnchoredStartAt', () => {
  it('relativeMonthsPast uses capture anchor not LLM startAt', () => {
    const capturedAt = new Date('2023-05-28T07:17:00.000Z')
    const result = resolveAnchoredStartAt({
      startAt: '2023-05-28T00:00:00.000Z',
      capturedAt,
      relativeSpec: { dateAnchor: 'capture_time', relativeMonthsPast: 2 },
    })
    expect(result.toISOString().slice(0, 10)).toBe('2023-03-28')
  })

  it('calendarDate overrides bad LLM relative resolution', () => {
    const result = resolveAnchoredStartAt({
      startAt: '2026-06-01T00:00:00.000Z',
      capturedAt: new Date('2023-03-10T00:00:00.000Z'),
      relativeSpec: { dateAnchor: 'explicit', calendarDate: '2023-02-20' },
    })
    expect(result.toISOString().slice(0, 10)).toBe('2023-02-20')
  })

  it('mid-February uses calendarMonthPart', () => {
    const result = resolveAnchoredStartAt({
      startAt: '2026-01-01T00:00:00.000Z',
      capturedAt: new Date('2023-03-10T22:50:00.000Z'),
      relativeSpec: {
        dateAnchor: 'explicit',
        calendarMonth: 2,
        calendarMonthPart: 'mid',
      },
    })
    expect(result.toISOString().slice(0, 10)).toBe('2023-02-15')
  })
})
