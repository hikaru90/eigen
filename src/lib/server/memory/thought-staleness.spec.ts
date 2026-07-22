import { describe, expect, it } from 'vitest'
import {
  isThoughtNeverStale,
  isThoughtStaleByAge,
  NEVER_STALE_METADATA_KEY,
} from './thought-staleness'

describe('thought-staleness', () => {
  it('never stale when metadata flag is set', () => {
    expect(
      isThoughtNeverStale({
        memoryType: 'episode',
        metadata: { [NEVER_STALE_METADATA_KEY]: true },
      }),
    ).toBe(true)
  })

  it('never stale for durable memory types', () => {
    expect(isThoughtNeverStale({ memoryType: 'fact', metadata: {} })).toBe(true)
    expect(isThoughtNeverStale({ memoryType: 'episode', metadata: {} })).toBe(false)
  })

  it('skips age staleness for exempt thoughts', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const old = new Date('2020-01-01T00:00:00Z')
    expect(
      isThoughtStaleByAge({
        createdAt: old,
        now,
        thresholdMs: 1,
        memoryType: 'fact',
        metadata: {},
      }),
    ).toBe(false)
    expect(
      isThoughtStaleByAge({
        createdAt: old,
        now,
        thresholdMs: 1,
        memoryType: 'episode',
        metadata: {},
      }),
    ).toBe(true)
  })
})
