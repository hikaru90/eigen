import { describe, expect, it } from 'vitest'
import { computeTopUpCheckout } from '$lib/billing/top-up-checkout'
import {
  CHECKOUT_GROSS_TOLERANCE_CENTS,
  netCoversPlatformSubtotal,
  usdStringsMatchWithinTolerance,
} from './checkout-pricing'

describe('checkout-pricing (server helpers)', () => {
  it('matches USD strings within cent tolerance', () => {
    expect(usdStringsMatchWithinTolerance('1.75', '1.75')).toBe(true)
    expect(usdStringsMatchWithinTolerance('1.75', '1.745', CHECKOUT_GROSS_TOLERANCE_CENTS)).toBe(
      true,
    )
    expect(usdStringsMatchWithinTolerance('1.75', '1.72', CHECKOUT_GROSS_TOLERANCE_CENTS)).toBe(
      false,
    )
  })

  it('validates net covers platform subtotal', () => {
    expect(netCoversPlatformSubtotal('1.20', '1.200000')).toBe(true)
    expect(netCoversPlatformSubtotal('1.19', '1.200000')).toBe(true)
    expect(netCoversPlatformSubtotal('1.18', '1.200000')).toBe(false)
  })

  it('delegates quote to shared top-up-checkout', () => {
    const quote = computeTopUpCheckout(1000)
    expect(quote.totalDueUsd).toBe('1.75')
    expect(quote.paypalFeeUsd).toBe('0.54')
  })
})
