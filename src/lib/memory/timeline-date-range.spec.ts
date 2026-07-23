import { describe, expect, it } from 'vitest'
import {
  computePresetAbsoluteRange,
  computeRelevantAbsoluteRange,
  formatParseDateRangeHttpError,
  itemOverlapsAbsoluteRange,
  RELEVANT_LOOKAHEAD_DAYS,
} from './timeline-date-range'

describe('computeRelevantAbsoluteRange', () => {
  it('anchors from=now and to=now+lookahead with includeUndated', () => {
    const now = new Date('2026-07-21T12:00:00.000Z')
    const range = computeRelevantAbsoluteRange(now)
    expect(range.from).toBe(now.toISOString())
    expect(range.to).toBe(
      new Date(now.getTime() + RELEVANT_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    )
    expect(range.includeUndated).toBe(true)
  })
})

describe('computePresetAbsoluteRange', () => {
  const now = new Date('2026-07-21T12:00:00.000Z')

  it('resolves last-week locally (no LLM): rolling 7 days, exclude undated', () => {
    const range = computePresetAbsoluteRange('last-week', now)
    expect(range.label).toBe('Last week')
    expect(range.includeUndated).toBe(false)
    expect(range.from).toBe('2026-07-14T00:00:00.000Z')
    expect(range.to).toBe('2026-07-21T23:59:59.999Z')
  })

  it('resolves last-month locally: rolling 30 days, exclude undated', () => {
    const range = computePresetAbsoluteRange('last-month', now)
    expect(range.label).toBe('Last month')
    expect(range.includeUndated).toBe(false)
    expect(range.from).toBe('2026-06-21T00:00:00.000Z')
    expect(range.to).toBe('2026-07-21T23:59:59.999Z')
  })

  it('resolves all-time locally: unbounded + include undated', () => {
    expect(computePresetAbsoluteRange('all-time', now)).toEqual({
      from: null,
      to: null,
      includeUndated: true,
      label: 'All time',
    })
  })
})

describe('formatParseDateRangeHttpError', () => {
  it('prefers JSON error from the API', () => {
    expect(
      formatParseDateRangeHttpError(
        502,
        JSON.stringify({
          error:
            'Date parsing is temporarily unavailable. Try Last week / Last month, or try again.',
        }),
      ),
    ).toBe('Date parsing is temporarily unavailable. Try Last week / Last month, or try again.')
  })

  it('maps bare proxy 502 Bad Gateway to a clear dial message', () => {
    expect(formatParseDateRangeHttpError(502, 'Bad Gateway')).toBe(
      'Date parsing is temporarily unavailable. Try Last week / Last month, or try again.',
    )
  })
})

describe('itemOverlapsAbsoluteRange', () => {
  const window = {
    from: '2026-07-14T00:00:00.000Z',
    to: '2026-07-21T23:59:59.999Z',
    includeUndated: true,
  }

  it('includes undated items only when includeUndated is true', () => {
    const undated = { startAt: null, endAt: null, createdAt: '2026-01-01T00:00:00.000Z' }
    expect(itemOverlapsAbsoluteRange(undated, window)).toBe(true)
    expect(itemOverlapsAbsoluteRange(undated, { ...window, includeUndated: false })).toBe(false)
  })

  it('includes items that overlap the window', () => {
    expect(
      itemOverlapsAbsoluteRange(
        {
          startAt: '2026-07-15T10:00:00.000Z',
          endAt: '2026-07-15T11:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        window,
      ),
    ).toBe(true)
  })

  it('excludes items entirely before or after the window', () => {
    expect(
      itemOverlapsAbsoluteRange(
        {
          startAt: '2026-07-01T10:00:00.000Z',
          endAt: '2026-07-01T11:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        window,
      ),
    ).toBe(false)
    expect(
      itemOverlapsAbsoluteRange(
        {
          startAt: '2026-07-25T10:00:00.000Z',
          endAt: '2026-07-25T11:00:00.000Z',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        window,
      ),
    ).toBe(false)
  })
})
