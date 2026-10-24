import { describe, expect, it } from 'vitest'
import { creditMeterFraction } from './credit-meter'

describe('creditMeterFraction', () => {
  it('is the share of the last funding still left', () => {
    expect(creditMeterFraction({ available: 750, spentSinceFunding: 250 })).toBe(0.75)
  })

  it('is full when nothing was spent since the last top-up', () => {
    expect(creditMeterFraction({ available: 500, spentSinceFunding: 0 })).toBe(1)
  })

  it('is empty when the wallet is empty', () => {
    expect(creditMeterFraction({ available: 0, spentSinceFunding: 300 })).toBe(0)
    expect(creditMeterFraction({ available: 0, spentSinceFunding: 0 })).toBe(0)
  })

  it('clamps to [0, 1]', () => {
    expect(creditMeterFraction({ available: -5, spentSinceFunding: 10 })).toBe(0)
  })
})
