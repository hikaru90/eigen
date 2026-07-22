import { describe, expect, it } from 'vitest'
import {
  annotateTemporalEvents,
  classifyThoughtTemporalStatus,
  formatTemporalAnnotation,
  isActivePeriodExpired,
  parseActivePeriodLiteral,
} from './temporal-validity'

const DAY_START = '2026-05-28T00:00:00.000Z'
const DAY_END = '2026-05-29T00:00:00.000Z'
const DAY_PERIOD = `[${DAY_START},${DAY_END})`

describe('parseActivePeriodLiteral', () => {
  it('parses half-open tsrange literals', () => {
    const bounds = parseActivePeriodLiteral(DAY_PERIOD)
    expect(bounds.start.toISOString()).toBe(DAY_START)
    expect(bounds.end.toISOString()).toBe(DAY_END)
  })

  it('parses Postgres driver tsrange format with space-separated timestamps', () => {
    const pgLiteral = '["2026-05-27 00:00:00","2026-05-27 23:59:59")'
    const bounds = parseActivePeriodLiteral(pgLiteral)
    expect(bounds.start.toISOString()).toBe('2026-05-27T00:00:00.000Z')
    expect(bounds.end.toISOString()).toBe('2026-05-27T23:59:59.000Z')
  })

  it('throws on invalid literals', () => {
    expect(() => parseActivePeriodLiteral('not-a-range')).toThrow(/Invalid tsrange literal/)
  })
})

describe('isActivePeriodExpired', () => {
  it('is expired when now is at or past range end', () => {
    expect(isActivePeriodExpired(DAY_PERIOD, new Date(DAY_END))).toBe(true)
    expect(isActivePeriodExpired(DAY_PERIOD, new Date('2026-06-05T12:00:00.000Z'))).toBe(true)
  })

  it('is active when now is before range end', () => {
    expect(isActivePeriodExpired(DAY_PERIOD, new Date('2026-05-28T18:00:00.000Z'))).toBe(false)
  })
})

describe('classifyThoughtTemporalStatus', () => {
  const event = {
    kind: 'reminder',
    semanticSummary: 'go inline skating today',
    activePeriod: DAY_PERIOD,
  }

  it('returns none for empty events', () => {
    expect(classifyThoughtTemporalStatus([], new Date('2026-06-05T00:00:00.000Z'))).toBe('none')
  })

  it('returns expired when all events ended', () => {
    expect(classifyThoughtTemporalStatus([event], new Date('2026-06-05T00:00:00.000Z'))).toBe(
      'expired',
    )
  })

  it('returns active when at least one event is still active', () => {
    const future = {
      kind: 'appointment',
      semanticSummary: 'dentist next week',
      activePeriod: '[2026-06-10T00:00:00.000Z,2026-06-11T00:00:00.000Z)',
    }
    expect(
      classifyThoughtTemporalStatus([event, future], new Date('2026-06-05T00:00:00.000Z')),
    ).toBe('active')
  })
})

describe('formatTemporalAnnotation', () => {
  it('returns empty string when status is none', () => {
    expect(formatTemporalAnnotation([], 'none', new Date('2026-06-05T00:00:00.000Z'))).toBe('')
  })

  it('formats expired events with as-of date', () => {
    const events = annotateTemporalEvents(
      [{ kind: 'reminder', semanticSummary: 'go inline skating today', activePeriod: DAY_PERIOD }],
      new Date('2026-06-05T00:00:00.000Z'),
    )
    const annotation = formatTemporalAnnotation(
      events,
      'expired',
      new Date('2026-06-05T00:00:00.000Z'),
    )
    expect(annotation).toContain('temporal:')
    expect(annotation).toContain('go inline skating today')
    expect(annotation).toContain('EXPIRED')
    expect(annotation).toContain('all periods ended as of')
  })

  it('formats active events without as-of suffix', () => {
    const events = annotateTemporalEvents(
      [{ kind: 'reminder', semanticSummary: 'go inline skating today', activePeriod: DAY_PERIOD }],
      new Date('2026-05-28T12:00:00.000Z'),
    )
    const annotation = formatTemporalAnnotation(
      events,
      'active',
      new Date('2026-05-28T12:00:00.000Z'),
    )
    expect(annotation).toContain('ACTIVE')
    expect(annotation).not.toContain('all periods ended')
  })
})
