import {
  CREDITS_PER_USD,
  MIN_TOP_UP_CREDITS,
  PLATFORM_MARKUP_RATE,
  computeTopUpCheckout,
  computeTopUpCheckoutUi,
  PAYPAL_CHECKOUT_FEE_USD,
  type TopUpCheckoutQuote,
  type TopUpCheckoutQuoteUi,
} from '$lib/billing/top-up-checkout'

export {
  CREDITS_PER_USD,
  MIN_TOP_UP_CREDITS,
  PLATFORM_MARKUP_RATE,
  PAYPAL_CHECKOUT_FEE_USD,
  computeTopUpCheckout,
  computeTopUpCheckoutUi,
  type TopUpCheckoutQuote,
  type TopUpCheckoutQuoteUi,
}

export function platformMarkupPercentLabel(): string {
  return `${Math.round(PLATFORM_MARKUP_RATE * 100)}%`
}

/** Shown at credit purchase only — not in Activity. */
export function purchaseMarkupDisclosureText(): string {
  return `Top-ups include a ${platformMarkupPercentLabel()} platform fee plus PayPal processing fees in the checkout total. Usage also debits your wallet at gateway rates plus ${platformMarkupPercentLabel()}. ${CREDITS_PER_USD.toLocaleString('en-US')} credits = $1 USD of gateway value.`
}

/** Convert all-in stored total USD (gateway + markup) to a numeric credit amount. */
export function totalCostUsdToCredits(totalCostUsd: string): number {
  const parsed = Number(totalCostUsd)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed * CREDITS_PER_USD
}

/** User-facing Activity / totals label for a stored totalCostUsd string. */
export function formatActivityCredits(totalCostUsd: string): string {
  return formatCreditsAmount(totalCostUsdToCredits(totalCostUsd))
}

function formatCreditsAmount(credits: number): string {
  if (credits === 0) return '0'
  if (credits < 1) {
    const formatted = credits.toFixed(3).replace(/\.?0+$/, '')
    return formatted.length > 0 ? formatted : '0'
  }
  if (Number.isInteger(credits)) {
    return credits.toLocaleString('en-US')
  }
  return credits.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** Sum multiple totalCostUsd strings and format as credits. */
export function formatActivityCreditsSum(totalCostUsdValues: string[]): string {
  let sum = 0
  for (const v of totalCostUsdValues) {
    sum += totalCostUsdToCredits(v)
  }
  return formatCreditsAmount(sum)
}

/** Whole credits → USD gateway value for balance display. */
export function creditsToUsd(credits: number): number | null {
  if (!Number.isFinite(credits) || credits < 0) return null
  return credits / CREDITS_PER_USD
}

/** USD formatted for balance display (e.g. `$10.00`). */
export function formatCreditsAsUsd(credits: number): string | null {
  const usd = creditsToUsd(credits)
  if (usd === null) return null
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Format a numeric USD amount for checkout lines. */
export function formatUsdAmount(usd: number): string {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
