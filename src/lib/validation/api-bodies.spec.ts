import { describe, expect, it } from 'vitest'
import {
  parseDateRangeRequestSchema,
  parsedDateRangeSchema,
} from './api-bodies'

describe('parseDateRangeRequestSchema', () => {
  it('requires a non-empty phrase', () => {
    expect(parseDateRangeRequestSchema.safeParse({}).success).toBe(false)
    expect(parseDateRangeRequestSchema.safeParse({ phrase: '  ' }).success).toBe(false)
    const ok = parseDateRangeRequestSchema.safeParse({ phrase: ' last week ' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.phrase).toBe('last week')
  })

  it('accepts optional timeZone and nowIso', () => {
    const ok = parseDateRangeRequestSchema.safeParse({
      phrase: 'this month',
      timeZone: 'Europe/Berlin',
      nowIso: '2026-07-22T10:00:00.000Z',
    })
    expect(ok.success).toBe(true)
  })
})

describe('parsedDateRangeSchema', () => {
  it('accepts a valid absolute range payload', () => {
    const ok = parsedDateRangeSchema.safeParse({
      from: '2026-07-01T00:00:00.000Z',
      to: null,
      includeUndated: true,
      label: 'Relevant',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects non-ISO from/to', () => {
    expect(
      parsedDateRangeSchema.safeParse({
        from: 'not-a-date',
        to: null,
        includeUndated: true,
        label: 'x',
      }).success,
    ).toBe(false)
  })

  it('rejects empty label', () => {
    expect(
      parsedDateRangeSchema.safeParse({
        from: null,
        to: null,
        includeUndated: false,
        label: '  ',
      }).success,
    ).toBe(false)
  })
})
