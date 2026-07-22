import { describe, expect, it } from 'vitest'
import { parseOptionalIsoTimestamp, parseOptionalIsoTimestampOrNull } from './parse-iso'

describe('parseOptionalIsoTimestamp', () => {
  it('returns undefined for empty values', () => {
    expect(parseOptionalIsoTimestamp(undefined, 'captured_at')).toBeUndefined()
    expect(parseOptionalIsoTimestamp('', 'captured_at')).toBeUndefined()
  })

  it('parses valid ISO timestamps', () => {
    const parsed = parseOptionalIsoTimestamp('2023-03-15T12:00:00.000Z', 'captured_at')
    expect(parsed?.toISOString()).toBe('2023-03-15T12:00:00.000Z')
  })

  it('throws on invalid input', () => {
    expect(() => parseOptionalIsoTimestamp('not-a-date', 'captured_at')).toThrow(
      /not a valid ISO-8601/,
    )
    expect(() => parseOptionalIsoTimestamp(123, 'captured_at')).toThrow(
      /must be an ISO-8601 string/,
    )
  })
})

describe('parseOptionalIsoTimestampOrNull', () => {
  it('returns null for absent or unparseable values', () => {
    expect(parseOptionalIsoTimestampOrNull(undefined)).toBeNull()
    expect(parseOptionalIsoTimestampOrNull('')).toBeNull()
    expect(parseOptionalIsoTimestampOrNull('omit')).toBeNull()
    expect(parseOptionalIsoTimestampOrNull(123)).toBeNull()
  })

  it('parses valid ISO timestamps', () => {
    const parsed = parseOptionalIsoTimestampOrNull('2023-03-15T12:00:00.000Z')
    expect(parsed?.toISOString()).toBe('2023-03-15T12:00:00.000Z')
  })
})
