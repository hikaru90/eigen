import { describe, expect, it } from 'vitest'
import { seededSample, seededShuffle } from './seeded'

const items = Array.from({ length: 50 }, (_, i) => i)

describe('seededShuffle', () => {
  it('is deterministic for the same seed', () => {
    expect(seededShuffle(items, 'pilot-1')).toEqual(seededShuffle(items, 'pilot-1'))
  })

  it('differs across seeds', () => {
    expect(seededShuffle(items, 'pilot-1')).not.toEqual(seededShuffle(items, 'pilot-2'))
  })

  it('is a permutation and does not mutate the input', () => {
    const copy = [...items]
    const out = seededShuffle(items, 'perm')
    expect(items).toEqual(copy)
    expect(out).toHaveLength(items.length)
    expect([...out].sort((a, b) => a - b)).toEqual(items)
  })

  it('handles empty and single-item input', () => {
    expect(seededShuffle([], 's')).toEqual([])
    expect(seededShuffle(['x'], 's')).toEqual(['x'])
  })

  it('is stable across processes (golden order)', () => {
    expect(seededShuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'golden')).toEqual(GOLDEN)
  })

  it('rejects an empty seed', () => {
    expect(() => seededShuffle(items, '')).toThrow(/seed/)
    expect(() => seededShuffle(items, '   ')).toThrow(/seed/)
  })
})

describe('seededSample', () => {
  it('returns the first n of the seeded shuffle', () => {
    expect(seededSample(items, 7, 's')).toEqual(seededShuffle(items, 's').slice(0, 7))
  })

  it('returns distinct members of the input', () => {
    const out = seededSample(items, 20, 's')
    expect(new Set(out).size).toBe(20)
    for (const v of out) expect(items).toContain(v)
  })

  it('allows n = 0 and n = length', () => {
    expect(seededSample(items, 0, 's')).toEqual([])
    expect(seededSample(items, items.length, 's')).toHaveLength(items.length)
  })

  it('throws when n is negative, fractional or larger than the input', () => {
    expect(() => seededSample(items, -1, 's')).toThrow(/n/)
    expect(() => seededSample(items, 1.5, 's')).toThrow(/n/)
    expect(() => seededSample(items, items.length + 1, 's')).toThrow(/n/)
  })
})

// Cross-checked against an independent Python port of the same algorithm.
const GOLDEN = [7, 2, 0, 1, 6, 4, 5, 8, 3, 9]
