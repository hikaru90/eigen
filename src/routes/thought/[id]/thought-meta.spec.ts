import { describe, expect, it } from 'vitest'
import { longDateLabel } from './thought-meta'

/**
 * The meta line's long date (ei app.js:67-71 `longDate`): weekday, day and month,
 * then the clock, from `Intl` in the UI locale and the user's timezone — no copy of
 * our own in either language.
 */
describe('longDateLabel', () => {
  const iso = '2026-10-19T07:05:00.000Z'

  it('spells the day out in English, in the user zone', () => {
    const label = longDateLabel(iso, { locale: 'en', timeZone: 'Europe/Berlin' })
    expect(label).toContain('Monday')
    expect(label).toContain('October')
    expect(label).toContain('19')
    expect(label).toContain('09:05')
    expect(label).toContain(' · ')
  })

  it('speaks German when the UI does', () => {
    const label = longDateLabel(iso, { locale: 'de', timeZone: 'Europe/Berlin' })
    expect(label).toContain('Montag')
    expect(label).toContain('Oktober')
    expect(label).toContain('09:05')
  })

  it('returns nothing for an invalid date instead of a made-up one', () => {
    expect(longDateLabel('nope', { locale: 'en', timeZone: 'UTC' })).toBe('')
  })
})
