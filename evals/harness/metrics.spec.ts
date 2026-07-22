import { describe, expect, it } from 'vitest'
import {
  buildRelevanceMap,
  computeQueryMetrics,
  meanMetrics,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
} from './metrics'

describe('recallAtK', () => {
  it('returns 0 when there are no relevant items', () => {
    const rel = buildRelevanceMap([])
    expect(recallAtK(['a', 'b'], rel, 5)).toBe(0)
  })

  it('counts hits within the top-k window only', () => {
    const rel = buildRelevanceMap([
      { id: 'a', grade: 3 },
      { id: 'b', grade: 2 },
      { id: 'c', grade: 1 },
    ])
    expect(recallAtK(['a', 'x', 'b', 'c'], rel, 2)).toBeCloseTo(1 / 3)
    expect(recallAtK(['a', 'x', 'b', 'c'], rel, 4)).toBeCloseTo(1)
  })

  it('treats grade 0 entries as non-relevant', () => {
    const rel = buildRelevanceMap([
      { id: 'a', grade: 0 },
      { id: 'b', grade: 3 },
    ])
    expect(recallAtK(['a'], rel, 5)).toBe(0)
    expect(recallAtK(['b'], rel, 5)).toBe(1)
  })
})

describe('reciprocalRank', () => {
  it('returns 1 when the first item is relevant', () => {
    const rel = buildRelevanceMap([{ id: 'a', grade: 2 }])
    expect(reciprocalRank(['a', 'b'], rel)).toBe(1)
  })

  it('returns 1/k when the first relevant item is at rank k', () => {
    const rel = buildRelevanceMap([{ id: 'c', grade: 1 }])
    expect(reciprocalRank(['a', 'b', 'c'], rel)).toBeCloseTo(1 / 3)
  })

  it('returns 0 when no relevant item appears', () => {
    const rel = buildRelevanceMap([{ id: 'z', grade: 3 }])
    expect(reciprocalRank(['a', 'b'], rel)).toBe(0)
  })
})

describe('ndcgAtK', () => {
  it('is 1.0 when ranking matches ideal order', () => {
    const rel = buildRelevanceMap([
      { id: 'a', grade: 3 },
      { id: 'b', grade: 2 },
      { id: 'c', grade: 1 },
    ])
    expect(ndcgAtK(['a', 'b', 'c'], rel, 10)).toBeCloseTo(1, 6)
  })

  it('is less than 1 when relevant items are ranked behind irrelevant ones', () => {
    const rel = buildRelevanceMap([{ id: 'a', grade: 3 }])
    const better = ndcgAtK(['a', 'x'], rel, 10)
    const worse = ndcgAtK(['x', 'a'], rel, 10)
    expect(better).toBeGreaterThan(worse)
    expect(worse).toBeGreaterThan(0)
  })

  it('returns 0 when no relevant items exist', () => {
    expect(ndcgAtK(['a', 'b'], buildRelevanceMap([]), 10)).toBe(0)
  })

  it('respects the k cutoff', () => {
    const rel = buildRelevanceMap([{ id: 'a', grade: 3 }])
    expect(ndcgAtK(['x', 'a'], rel, 1)).toBe(0)
    expect(ndcgAtK(['x', 'a'], rel, 2)).toBeGreaterThan(0)
  })
})

describe('computeQueryMetrics', () => {
  it('packages all four metrics consistently', () => {
    const rel = buildRelevanceMap([
      { id: 'a', grade: 3 },
      { id: 'b', grade: 1 },
    ])
    const m = computeQueryMetrics(['a', 'x', 'b'], rel)
    expect(m.recallAt5).toBeCloseTo(1)
    expect(m.recallAt10).toBeCloseTo(1)
    expect(m.mrr).toBe(1)
    expect(m.ndcgAt10).toBeGreaterThan(0)
    expect(m.ndcgAt10).toBeLessThanOrEqual(1)
  })
})

describe('meanMetrics', () => {
  it('returns zeros for an empty list', () => {
    expect(meanMetrics([])).toEqual({ recallAt5: 0, recallAt10: 0, ndcgAt10: 0, mrr: 0 })
  })

  it('averages elementwise', () => {
    const a = { recallAt5: 1, recallAt10: 0.5, ndcgAt10: 0.8, mrr: 1 }
    const b = { recallAt5: 0, recallAt10: 0.5, ndcgAt10: 0.4, mrr: 0 }
    const mean = meanMetrics([a, b])
    expect(mean.recallAt5).toBeCloseTo(0.5)
    expect(mean.recallAt10).toBeCloseTo(0.5)
    expect(mean.ndcgAt10).toBeCloseTo(0.6)
    expect(mean.mrr).toBeCloseTo(0.5)
  })
})
