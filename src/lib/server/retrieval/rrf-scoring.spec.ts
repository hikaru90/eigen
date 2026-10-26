import { describe, expect, it } from 'vitest'
import {
  bestScoreBelowFloor,
  normalizeRetrievalScore,
  MAX_RETRIEVAL_MERGE_SCORE,
  reciprocalRankFusion,
  fuseRankedHits,
  RRF_K,
} from './rrf-scoring'

describe('normalizeRetrievalScore', () => {
  it('maps weighted-merge scores to [0, 1]', () => {
    expect(normalizeRetrievalScore(MAX_RETRIEVAL_MERGE_SCORE)).toBe(1)
    expect(normalizeRetrievalScore(MAX_RETRIEVAL_MERGE_SCORE / 2)).toBeCloseTo(0.5, 5)
  })

  it('clamps scores above the merge max (temporal-boosted scores reach 1.18)', () => {
    expect(normalizeRetrievalScore(1.18)).toBe(1)
    expect(normalizeRetrievalScore(2)).toBe(1)
  })

  it('clamps negative scores to 0', () => {
    expect(normalizeRetrievalScore(-0.5)).toBe(0)
  })
})

describe('bestScoreBelowFloor', () => {
  it('is the highest score that is still under the floor', () => {
    expect(bestScoreBelowFloor([0.1, 0.19, 0.5, 0.03], 0.22)).toBe(0.19)
  })

  it('treats a score equal to the floor as passing, not as below it', () => {
    expect(bestScoreBelowFloor([0.22, 0.1], 0.22)).toBe(0.1)
  })

  it('is null when every candidate passes or there are none', () => {
    expect(bestScoreBelowFloor([0.3, 0.9], 0.22)).toBeNull()
    expect(bestScoreBelowFloor([], 0.22)).toBeNull()
  })
})

describe('reciprocalRankFusion', () => {
  it('returns the single list unchanged', () => {
    expect(reciprocalRankFusion([['a', 'b', 'c']])).toEqual(['a', 'b', 'c'])
  })

  it('ranks an item found by several lists above one found top-1 by only one list', () => {
    expect(
      reciprocalRankFusion([
        ['a', 'x'],
        ['b', 'x'],
        ['c', 'x'],
      ]),
    ).toEqual(['x', 'a', 'b', 'c'])
  })

  it('deduplicates ids and sums 1/(k+rank) across lists', () => {
    const fused = reciprocalRankFusion([
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(fused).toHaveLength(2)
    expect(new Set(fused)).toEqual(new Set(['a', 'b']))
    expect(RRF_K).toBeGreaterThan(0)
  })

  it('breaks ties by first appearance (earlier list, earlier rank) — deterministic', () => {
    expect(reciprocalRankFusion([['a'], ['b'], ['c']])).toEqual(['a', 'b', 'c'])
  })

  it('returns [] for no lists or empty lists', () => {
    expect(reciprocalRankFusion([])).toEqual([])
    expect(reciprocalRankFusion([[], []])).toEqual([])
  })
})

describe('fuseRankedHits', () => {
  it('fuses hit lists by id, keeps the first-seen hit object, and honours the limit', () => {
    const hit = (id: string, score: number) => ({ id, score })
    const fused = fuseRankedHits(
      [
        [hit('a', 0.9), hit('b', 0.5)],
        [hit('b', 0.8), hit('c', 0.4)],
        [hit('b', 0.7), hit('d', 0.3)],
      ],
      2,
    )
    expect(fused.map((h) => h.id)).toEqual(['b', 'a'])
    expect(fused[0]!.score).toBe(0.5)
  })
})
