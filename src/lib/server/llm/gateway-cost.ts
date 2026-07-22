export type TokenUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export function parseUsdCost(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return 0
}

/**
 * Provider-reported billable USD from a gateway JSON body (`usage.cost` or top-level `cost`).
 * Returns null when the gateway omitted cost — never inferred from token counts.
 */
export function extractGatewayReportedCostUsd(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const root = body as { usage?: unknown; cost?: unknown }
  const fromRoot = parseUsdCost(root.cost)
  if (fromRoot > 0) return fromRoot
  const usage = root.usage
  if (!usage || typeof usage !== 'object') return null
  const fromUsage = parseUsdCost((usage as { cost?: unknown }).cost)
  if (fromUsage > 0) return fromUsage
  return null
}

/** Platform credits: bill only provider-reported cost; hard-fail when absent. */
export function requireGatewayReportedCostUsd(body: unknown): number {
  const cost = extractGatewayReportedCostUsd(body)
  if (cost === null) {
    throw new Error(
      'LLM gateway response missing usage.cost; platform credits require provider-reported cost (no estimates)',
    )
  }
  return cost
}

/** Activity / transparency logging — reported cost only, zero when the gateway omitted it. */
export function gatewayReportedCostUsdForLog(body: unknown): number {
  return extractGatewayReportedCostUsd(body) ?? 0
}
