/** Default per-call markup from requirements (AC-014). */
export const DEFAULT_MARKUP_RATE = 0.2 as const

export type PricedCall = {
  baseCostUsd: string
  markupUsd: string
  totalCostUsd: string
  markupRate: string
}

/**
 * Computes total with explicit markup (no hidden fees).
 * Uses string outputs with fixed 6 decimal places for stable tests and logs.
 */
export function priceCall(
  baseCostUsd: number,
  markupRate: number = DEFAULT_MARKUP_RATE,
): PricedCall {
  if (Number.isNaN(baseCostUsd) || baseCostUsd < 0) {
    throw new Error('baseCostUsd must be a non-negative finite number')
  }
  if (Number.isNaN(markupRate) || markupRate < 0) {
    throw new Error('markupRate must be a non-negative finite number')
  }
  const markup = baseCostUsd * markupRate
  const total = baseCostUsd + markup
  const fmt = (n: number) => n.toFixed(6)
  return {
    baseCostUsd: fmt(baseCostUsd),
    markupUsd: fmt(markup),
    totalCostUsd: fmt(total),
    markupRate: markupRate.toFixed(6),
  }
}
