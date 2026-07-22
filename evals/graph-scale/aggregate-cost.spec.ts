import { describe, expect, it } from 'vitest'
import { aggregateActivityCostFromRows } from './aggregate-cost'

describe('aggregateActivityCostFromRows', () => {
  it('sums USD, credits, and latency by operation', () => {
    const result = aggregateActivityCostFromRows([
      {
        operation: 'llm.chat.success',
        baseCostUsd: '0.001000',
        markupUsd: '0.000200',
        totalCostUsd: '0.001200',
        durationMs: 100,
      },
      {
        operation: 'llm.embedding.success',
        baseCostUsd: '0.000100',
        markupUsd: '0.000020',
        totalCostUsd: '0.000120',
        durationMs: 50,
      },
      {
        operation: 'llm.chat.success',
        baseCostUsd: '0.002000',
        markupUsd: '0.000400',
        totalCostUsd: '0.002400',
        durationMs: 200,
      },
    ])

    expect(result.callCount).toBe(3)
    expect(result.totalUsd).toBe('0.003720')
    expect(result.totalCredits).toBe(3.72)
    expect(result.totalMs).toBe(350)
    expect(result.byOperation['llm.chat.success']?.count).toBe(2)
    expect(result.byOperation['llm.chat.success']?.totalUsd).toBe('0.003600')
    expect(result.byOperation['llm.embedding.success']?.totalMs).toBe(50)
  })

  it('returns zeros for empty input', () => {
    const result = aggregateActivityCostFromRows([])
    expect(result.callCount).toBe(0)
    expect(result.totalUsd).toBe('0.000000')
    expect(result.totalCredits).toBe(0)
    expect(result.totalMs).toBe(0)
  })
})
