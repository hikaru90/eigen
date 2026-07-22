import { usdStringToCents } from '$lib/server/billing/money'

export {
  PAYPAL_CHECKOUT_FEE_USD,
  computeTopUpCheckout,
  grossUsdForTargetNetUsd,
  paypalFeeUsdForGross,
  type PayPalFeeConfig,
  type TopUpCheckoutQuote,
} from '$lib/billing/top-up-checkout'

/** Cent-level tolerance when comparing PayPal gross to quoted checkout. */
export const CHECKOUT_GROSS_TOLERANCE_CENTS = 1

/** Cent-level tolerance when verifying operator net vs quoted platform subtotal. */
export const CHECKOUT_NET_TOLERANCE_CENTS = 1

/** Compare two USD decimal strings at cent precision. */
export function usdStringsMatchWithinTolerance(
  a: string,
  b: string,
  toleranceCents = CHECKOUT_GROSS_TOLERANCE_CENTS,
): boolean {
  return Math.abs(usdStringToCents(a) - usdStringToCents(b)) <= toleranceCents
}

/** True when captured net covers quoted platform subtotal within tolerance. */
export function netCoversPlatformSubtotal(
  netUsd: string,
  platformSubtotalUsd: string,
  toleranceCents = CHECKOUT_NET_TOLERANCE_CENTS,
): boolean {
  return usdStringToCents(netUsd) + toleranceCents >= usdStringToCents(platformSubtotalUsd)
}
