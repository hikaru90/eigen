import type { OperationCostStats } from '$lib/server/activity/trace-cost'

export type SpendProbeThoughtRow = {
  index: number
  thoughtId: string
  groupId: string
  usd: string
  credits: number
  wallMs: number
  entityCount: number
  byOperation: Record<string, OperationCostStats>
}

export type SpendTrend = {
  sumUsd: string
  sumCredits: number
  sumWallMs: number
  firstHalfAvgUsd: number
  secondHalfAvgUsd: number
  deltaUsd: number
  minUsd: number
  maxUsd: number
  perStepDeltaUsd: number[]
  moreExpensiveOverTime: boolean
}

function avgUsd(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Pure spend trend from per-thought rows (numeric only). */
export function computeSpendTrend(rows: SpendProbeThoughtRow[]): SpendTrend {
  const usdValues = rows.map((row) => Number(row.usd))
  const sumUsdNum = usdValues.reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0)
  const sumCredits = rows.reduce((sum, row) => sum + row.credits, 0)
  const sumWallMs = rows.reduce((sum, row) => sum + row.wallMs, 0)

  const perStepDeltaUsd: number[] = []
  for (let i = 1; i < usdValues.length; i++) {
    perStepDeltaUsd.push(usdValues[i] - usdValues[i - 1])
  }

  const splitAt = Math.ceil(rows.length / 2)
  const firstHalf = usdValues.slice(0, splitAt)
  const secondHalf = usdValues.slice(splitAt)

  const firstHalfAvgUsd = avgUsd(firstHalf)
  const secondHalfAvgUsd = avgUsd(secondHalf)

  const minUsd = usdValues.length > 0 ? Math.min(...usdValues) : 0
  const maxUsd = usdValues.length > 0 ? Math.max(...usdValues) : 0

  return {
    sumUsd: sumUsdNum.toFixed(6),
    sumCredits,
    sumWallMs,
    firstHalfAvgUsd,
    secondHalfAvgUsd,
    deltaUsd: secondHalfAvgUsd - firstHalfAvgUsd,
    minUsd,
    maxUsd,
    perStepDeltaUsd,
    moreExpensiveOverTime: secondHalfAvgUsd > firstHalfAvgUsd,
  }
}
