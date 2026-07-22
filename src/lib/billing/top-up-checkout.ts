/** Eigen platform credits per one US dollar (matches server CREDITS_PER_USD). */
export const CREDITS_PER_USD = 1000

/** Minimum PayPal top-up (matches server MIN_TOP_UP_CREDITS). */
export const MIN_TOP_UP_CREDITS = 1000

/** Platform markup on credit purchase (matches server DEFAULT_MARKUP_RATE). */
export const PLATFORM_MARKUP_RATE = 0.2

/**
 * PayPal Checkout fee for USD settlement (Eigen checkout currency).
 * DE merchant schedule: 2.99% + USD 0.49 fixed when payment is received in USD.
 * @see https://www.paypal.com/de/business/fees
 */
export const PAYPAL_CHECKOUT_FEE_USD = {
  fixedUsd: 0.49,
  rate: 0.0299,
} as const

export type PayPalFeeConfig = {
  fixedUsd: number
  rate: number
}

/** Full checkout quote: platform markup + PayPal fee + total due, computed together. */
export type TopUpCheckoutQuote = {
  credits: number
  /** Gateway value before platform markup (USD, 6 dp). */
  baseUsd: string
  /** Platform markup portion (USD, 6 dp). */
  markupUsd: string
  /** base + markup — target net after PayPal (USD, 6 dp). */
  platformSubtotalUsd: string
  /** PayPal fee on totalDueUsd: fixed + rate × total (USD, 2 dp). */
  paypalFeeUsd: string
  /** Amount charged at PayPal checkout (USD, 2 dp). */
  totalDueUsd: string
  /** PayPal REST `amount.value` (USD, 2 dp). */
  paypalAmount: string
}

function fmtUsd6(n: number): string {
  return n.toFixed(6)
}

function fmtUsd2(n: number): string {
  return n.toFixed(2)
}

function paypalAmountFromUsd(totalDueUsd: number): string {
  const cents = Math.round(totalDueUsd * 100)
  if (cents < 1) {
    throw new Error('PayPal amount must be at least 1 cent')
  }
  return (cents / 100).toFixed(2)
}

/**
 * Gross USD so operator net after PayPal fees covers platform subtotal.
 * net = gross − (fixed + rate × gross) ≥ subtotal  ⇒  gross = (subtotal + fixed) / (1 − rate)
 */
export function grossUsdForTargetNetUsd(subtotalUsd: number, fees: PayPalFeeConfig): number {
  if (subtotalUsd <= 0) return 0
  const gross = (subtotalUsd + fees.fixedUsd) / (1 - fees.rate)
  return Math.ceil(gross * 100) / 100
}

/** PayPal fee for a given checkout gross (fixed + variable). */
export function paypalFeeUsdForGross(grossUsd: number, fees: PayPalFeeConfig): number {
  if (grossUsd <= 0) return 0
  return Math.round((fees.fixedUsd + fees.rate * grossUsd) * 100) / 100
}

/**
 * Quote what the user pays for `credits`, including platform markup and PayPal fees.
 * PayPal fee and total due are derived from the same gross-up — not added separately later.
 */
export function computeTopUpCheckout(
  credits: number,
  fees: PayPalFeeConfig = PAYPAL_CHECKOUT_FEE_USD,
  markupRate: number = PLATFORM_MARKUP_RATE,
): TopUpCheckoutQuote {
  if (!Number.isInteger(credits) || credits < MIN_TOP_UP_CREDITS) {
    throw new Error(`credits must be an integer of at least ${MIN_TOP_UP_CREDITS}`)
  }

  const baseUsd = credits / CREDITS_PER_USD
  const markupUsd = baseUsd * markupRate
  const platformSubtotalUsd = baseUsd + markupUsd
  const totalDueUsd = grossUsdForTargetNetUsd(platformSubtotalUsd, fees)
  const paypalFeeUsd = paypalFeeUsdForGross(totalDueUsd, fees)

  return {
    credits,
    baseUsd: fmtUsd6(baseUsd),
    markupUsd: fmtUsd6(markupUsd),
    platformSubtotalUsd: fmtUsd6(platformSubtotalUsd),
    paypalFeeUsd: fmtUsd2(paypalFeeUsd),
    totalDueUsd: fmtUsd2(totalDueUsd),
    paypalAmount: paypalAmountFromUsd(totalDueUsd),
  }
}

/** Numeric fields for UI display (same quote, parsed). */
export type TopUpCheckoutQuoteUi = {
  credits: number
  baseUsd: number
  markupUsd: number
  platformSubtotalUsd: number
  paypalFeeUsd: number
  totalDueUsd: number
}

export function computeTopUpCheckoutUi(credits: number): TopUpCheckoutQuoteUi | null {
  if (!Number.isInteger(credits) || credits < MIN_TOP_UP_CREDITS) return null
  const quote = computeTopUpCheckout(credits)
  return {
    credits: quote.credits,
    baseUsd: Number(quote.baseUsd),
    markupUsd: Number(quote.markupUsd),
    platformSubtotalUsd: Number(quote.platformSubtotalUsd),
    paypalFeeUsd: Number(quote.paypalFeeUsd),
    totalDueUsd: Number(quote.totalDueUsd),
  }
}
