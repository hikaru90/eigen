import { describe, expect, it } from 'vitest'
import {
  bestScoreBelowFloor,
  normalizeRetrievalScore,
  MAX_RETRIEVAL_MERGE_SCORE,
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
