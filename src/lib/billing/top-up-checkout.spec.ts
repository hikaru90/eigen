import { describe, expect, it } from 'vitest'
import {
  computeTopUpCheckout,
  grossUsdForTargetNetUsd,
  PAYPAL_CHECKOUT_FEE_USD,
  paypalFeeUsdForGross,
} from './top-up-checkout'

describe('top-up-checkout', () => {
  it('computes PayPal fee and total due together from credits', () => {
    const quote = computeTopUpCheckout(1000)
    expect(quote.baseUsd).toBe('1.000000')
    expect(quote.markupUsd).toBe('0.200000')
    expect(quote.platformSubtotalUsd).toBe('1.200000')
    expect(quote.totalDueUsd).toBe('1.75')
    expect(quote.paypalAmount).toBe('1.75')
    expect(quote.paypalFeeUsd).toBe('0.54')
    const net = Number(quote.totalDueUsd) - Number(quote.paypalFeeUsd)
    expect(net).toBeGreaterThanOrEqual(Number(quote.platformSubtotalUsd) - 0.01)
  })

  it('grosses up subtotal to cover PayPal fixed + variable fees', () => {
    const gross = grossUsdForTargetNetUsd(1.2, PAYPAL_CHECKOUT_FEE_USD)
    expect(gross).toBe(1.75)
    const fee = paypalFeeUsdForGross(gross, PAYPAL_CHECKOUT_FEE_USD)
    expect(gross - fee).toBeGreaterThanOrEqual(1.2 - 0.01)
  })

  it('scales quote for larger top-ups', () => {
    const quote = computeTopUpCheckout(10_000)
    expect(quote.platformSubtotalUsd).toBe('12.000000')
    expect(quote.paypalAmount).toBe('12.88')
  })

  it('uses PayPal Checkout USD fee constants (2.99% + $0.49)', () => {
    expect(PAYPAL_CHECKOUT_FEE_USD.fixedUsd).toBe(0.49)
    expect(PAYPAL_CHECKOUT_FEE_USD.rate).toBe(0.0299)
  })
})
