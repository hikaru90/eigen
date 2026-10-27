import { describe, expect, it } from 'vitest'
import { downRate, formatDownRate } from './capture-quality-rates'

describe('capture quality rates', () => {
  it('is null and a dash when nobody voted', () => {
    expect(downRate({ voted: 0, down: 0 })).toBeNull()
    expect(formatDownRate({ voted: 0, down: 0 })).toBe('—')
  })
  it('is down over voted, as a percent', () => {
    expect(downRate({ voted: 4, down: 1 })).toBe(0.25)
    expect(formatDownRate({ voted: 4, down: 1 })).toBe('25%')
    expect(formatDownRate({ voted: 3, down: 1 })).toBe('33%')
    expect(formatDownRate({ voted: 2, down: 2 })).toBe('100%')
  })
})
