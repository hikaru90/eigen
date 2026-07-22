import { describe, expect, it } from 'vitest'
import { expandRruleOccurrences } from './temporal-rrule'

describe('expandRruleOccurrences', () => {
  it('expands daily rule within range', () => {
    const dtstart = new Date('2026-06-01T09:00:00.000Z')
    const rangeStart = new Date('2026-06-01T00:00:00.000Z')
    const rangeEnd = new Date('2026-06-04T00:00:00.000Z')
    const occ = expandRruleOccurrences({
      rrule: 'FREQ=DAILY;INTERVAL=1;COUNT=3',
      dtstart,
      rangeStart,
      rangeEnd,
    })
    expect(occ).toHaveLength(3)
  })
})
