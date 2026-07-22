import { describe, expect, it } from 'vitest'
import {
  CREDITS_PER_USD,
  STARTING_FREE_CREDITS,
  creditsToPayPalUsdAmount,
  formatEigenCredits,
  microUsdToWholeCredits,
  usdToCredits,
} from './credits'

describe('Eigen platform credits', () => {
  it('STARTING_FREE_CREDITS is 100', () => {
    expect(STARTING_FREE_CREDITS).toBe(100)
  })

  it('converts USD to credits at 1000 per dollar', () => {
    expect(usdToCredits(10)).toBe(10_000)
    expect(usdToCredits(0.001)).toBe(1)
  })

  it('debits whole credits from accumulated micro-USD', () => {
    expect(microUsdToWholeCredits(0)).toBe(0)
    expect(microUsdToWholeCredits(999)).toBe(0)
    expect(microUsdToWholeCredits(1000)).toBe(1)
    expect(microUsdToWholeCredits(50_000)).toBe(50)
  })

  it('formats credits without fiat', () => {
    expect(formatEigenCredits(16650)).toBe('16,650 credits')
  })

  it('maps credits to PayPal USD strings', () => {
    expect(creditsToPayPalUsdAmount(10_000)).toBe('10.00')
    expect(CREDITS_PER_USD).toBe(1000)
  })
})
