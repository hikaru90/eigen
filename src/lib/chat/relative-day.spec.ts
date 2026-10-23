import { describe, expect, it } from 'vitest'
import { relativeDayLabel } from './relative-day'

// Local-time constructors keep the calendar-day arithmetic independent of the test box's zone.
const now = new Date(2026, 9, 20, 15, 30) // Tue 20 Oct 2026, 15:30 local
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString()

describe('relativeDayLabel — quiet relative time for sessions and sources', () => {
  it('says today / yesterday in the UI locale, with no hardcoded words', () => {
    expect(relativeDayLabel(at(2026, 9, 20), now, 'en')).toBe('today')
    expect(relativeDayLabel(at(2026, 9, 19, 23), now, 'en')).toBe('yesterday')
    expect(relativeDayLabel(at(2026, 9, 20), now, 'de')).toBe('heute')
    expect(relativeDayLabel(at(2026, 9, 19), now, 'de')).toBe('gestern')
  })

  it('counts days back inside one week', () => {
    expect(relativeDayLabel(at(2026, 9, 17), now, 'en')).toBe('3 days ago')
    expect(relativeDayLabel(at(2026, 9, 17), now, 'de')).toBe('vor 3 Tagen')
  })

  it('falls back to a short date beyond a week, adding the year when it differs', () => {
    expect(relativeDayLabel(at(2026, 9, 1), now, 'en')).toBe('Oct 1')
    expect(relativeDayLabel(at(2025, 11, 24), now, 'en')).toBe('Dec 24, 2025')
    expect(relativeDayLabel(at(2026, 9, 1), now, 'de')).toBe('1. Okt.')
  })

  it('returns an empty label for unparseable input instead of throwing', () => {
    expect(relativeDayLabel('not a date', now, 'en')).toBe('')
  })
})
