import { describe, expect, it } from 'vitest'
import {
  isThoughtNeverStale,
  isThoughtSalienceExempt,
  isThoughtStaleByAge,
  NEVER_STALE_METADATA_KEY,
} from './thought-staleness'

const NEVER_STALE_CATEGORIES: ReadonlySet<string> = new Set([
  'decision',
  'reference',
  'goal',
  'reflection',
  'idea',
])

describe('thought-staleness', () => {
  it('never stale when metadata flag is set', () => {
    expect(
      isThoughtNeverStale({
        category: 'observation',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: { [NEVER_STALE_METADATA_KEY]: true },
      }),
    ).toBe(true)
  })

  it('never stale when the category kind is durable', () => {
    expect(
      isThoughtNeverStale({
        category: 'decision',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(true)
    expect(
      isThoughtNeverStale({
        category: 'reference',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(true)
  })

  it('stale-able for perishable categories', () => {
    for (const category of ['observation', 'task', 'feeling', 'question', 'memory']) {
      expect(
        isThoughtNeverStale({
          category,
          neverStaleCategories: NEVER_STALE_CATEGORIES,
          metadata: {},
        }),
      ).toBe(false)
    }
  })

  it('unknown or custom categories are perishable unless flagged in metadata', () => {
    expect(
      isThoughtNeverStale({
        category: 'custom_user_kind',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(false)
  })

  it('salience exemption mirrors never-stale', () => {
    expect(
      isThoughtSalienceExempt({
        category: 'goal',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(true)
    expect(
      isThoughtSalienceExempt({
        category: 'task',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(false)
  })

  it('skips age staleness for durable categories', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const old = new Date('2020-01-01T00:00:00Z')
    expect(
      isThoughtStaleByAge({
        createdAt: old,
        now,
        thresholdMs: 1,
        category: 'decision',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(false)
    expect(
      isThoughtStaleByAge({
        createdAt: old,
        now,
        thresholdMs: 1,
        category: 'observation',
        neverStaleCategories: NEVER_STALE_CATEGORIES,
        metadata: {},
      }),
    ).toBe(true)
  })
})
