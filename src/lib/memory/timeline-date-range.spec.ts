import { describe, expect, it } from 'vitest'
import {
  computeRelevantAbsoluteRange,
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
