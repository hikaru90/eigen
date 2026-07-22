import { describe, expect, it } from 'vitest'
import { computeSpendTrend, type SpendProbeThoughtRow } from '$lib/e2e/graph-scale-spend-trend'

function row(index: number, usd: string, credits: number): SpendProbeThoughtRow {
  return {
    index,
    thoughtId: `thought-${index}`,
    groupId: `group-${index}`,
    usd,
    credits,
    wallMs: 1000 + index,
    entityCount: 1,
    byOperation: {},
  }
}

describe('computeSpendTrend', () => {
  it('sums totals across rows', () => {
    const trend = computeSpendTrend([
      row(0, '0.001000', 1),
      row(1, '0.002000', 2),
      row(2, '0.003000', 3),
    ])

    expect(trend.sumUsd).toBe('0.006000')
    expect(trend.sumCredits).toBe(6)
    expect(trend.sumWallMs).toBe(3003)
    expect(trend.minUsd).toBe(0.001)
    expect(trend.maxUsd).toBe(0.003)
  })

  it('computes per-step deltas', () => {
    const trend = computeSpendTrend([row(0, '0.001000', 1), row(1, '0.003000', 3)])

    expect(trend.perStepDeltaUsd).toEqual([0.002])
  })

  it('flags more expensive over time when second half average is higher', () => {
    const trend = computeSpendTrend([
      row(0, '0.001000', 1),
      row(1, '0.001100', 1.1),
      row(2, '0.002000', 2),
      row(3, '0.003000', 3),
    ])

    expect(trend.firstHalfAvgUsd).toBeCloseTo(0.00105, 6)
    expect(trend.secondHalfAvgUsd).toBeCloseTo(0.0025, 6)
    expect(trend.deltaUsd).toBeCloseTo(0.00145, 6)
    expect(trend.moreExpensiveOverTime).toBe(true)
  })

  it('handles odd row counts with ceil split', () => {
    const trend = computeSpendTrend([
      row(0, '0.003000', 3),
      row(1, '0.002000', 2),
      row(2, '0.001000', 1),
    ])

    expect(trend.firstHalfAvgUsd).toBeCloseTo(0.0025, 6)
    expect(trend.secondHalfAvgUsd).toBeCloseTo(0.001, 6)
    expect(trend.moreExpensiveOverTime).toBe(false)
  })

  it('returns zeros for empty input', () => {
    const trend = computeSpendTrend([])

    expect(trend.sumUsd).toBe('0.000000')
    expect(trend.sumCredits).toBe(0)
    expect(trend.sumWallMs).toBe(0)
    expect(trend.firstHalfAvgUsd).toBe(0)
    expect(trend.secondHalfAvgUsd).toBe(0)
    expect(trend.moreExpensiveOverTime).toBe(false)
  })

  it('handles a single row', () => {
    const trend = computeSpendTrend([row(0, '0.004000', 4)])

    expect(trend.firstHalfAvgUsd).toBe(0.004)
    expect(trend.secondHalfAvgUsd).toBe(0)
    expect(trend.perStepDeltaUsd).toEqual([])
    expect(trend.moreExpensiveOverTime).toBe(false)
  })
})
