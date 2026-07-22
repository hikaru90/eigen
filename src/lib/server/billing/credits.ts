/** Eigen platform credits per one US dollar (user-facing unit). */
export const CREDITS_PER_USD = 1000

/** Micro-USD accumulated per one Eigen credit ($0.001 USD). */
export const MICRO_USD_PER_CREDIT = 1000

/** Free Eigen credits granted once on signup (platform credits). */
export const STARTING_FREE_CREDITS = 100

/** Minimum balance before capture classify + embed (platform credits). */
export const MIN_CAPTURE_PIPELINE_CREDITS = 50

/** Minimum top-up / PayPal purchase (1000 credits = $1 USD). */
export const MIN_TOP_UP_CREDITS = 1000

export function assertIntegerCredits(value: number, label = 'credits'): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

/** Convert gateway USD to whole Eigen credits (rounded). */
export function usdToCredits(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error('usd must be a non-negative finite number')
  }
  return Math.round(usd * CREDITS_PER_USD)
}

/** Whole Eigen credits debited from accumulated micro-USD billing. */
export function microUsdToWholeCredits(microUsd: number): number {
  assertIntegerCredits(microUsd, 'microUsd')
  return Math.floor(microUsd / MICRO_USD_PER_CREDIT)
}

/** PayPal USD amount string from Eigen credits (two decimal places). */
export function creditsToPayPalUsdAmount(credits: number): string {
  if (!Number.isInteger(credits) || credits < MIN_TOP_UP_CREDITS) {
    throw new Error(`Amount must be at least ${MIN_TOP_UP_CREDITS} credits`)
  }
  return (credits / CREDITS_PER_USD).toFixed(2)
}

/** User-facing balance label (no fiat). */
export function formatEigenCredits(credits: number): string {
  if (!Number.isInteger(credits)) {
    throw new Error('credits must be an integer')
  }
  return `${credits.toLocaleString('en-US')} credits`
}
