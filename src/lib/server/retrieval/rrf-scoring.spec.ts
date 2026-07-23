import { describe, expect, it } from 'vitest'
import { normalizeRetrievalScore, MAX_RETRIEVAL_MERGE_SCORE } from './rrf-scoring'

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
