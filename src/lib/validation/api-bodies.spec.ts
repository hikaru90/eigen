import { describe, expect, it } from 'vitest'
import { FEEDBACK_MAX_LENGTH } from '$lib/feedback/feedback-max-length'
import {
  feedbackPostBodySchema,
  parseDateRangeRequestSchema,
  parsedDateRangeSchema,
} from './api-bodies'

describe('feedbackPostBodySchema', () => {
  it('accepts a trimmed non-empty message', () => {
    const result = feedbackPostBodySchema.safeParse({ message: '  hello  ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.message).toBe('hello')
  })

  it('rejects missing message', () => {
    expect(feedbackPostBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects non-string message', () => {
    expect(feedbackPostBodySchema.safeParse({ message: 42 }).success).toBe(false)
  })

  it('rejects empty / whitespace-only message', () => {
    expect(feedbackPostBodySchema.safeParse({ message: '   ' }).success).toBe(false)
  })

  it('rejects oversized message', () => {
    expect(
      feedbackPostBodySchema.safeParse({ message: 'x'.repeat(FEEDBACK_MAX_LENGTH + 1) }).success,
    ).toBe(false)
  })

  it('accepts message of exactly max length', () => {
    expect(
      feedbackPostBodySchema.safeParse({ message: 'x'.repeat(FEEDBACK_MAX_LENGTH) }).success,
    ).toBe(true)
  })
})

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
