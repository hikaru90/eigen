import { describe, expect, it } from 'vitest'
import { defaultProductionOnlyForDrain } from './drain'

describe('defaultProductionOnlyForDrain', () => {
  it('defaults to production-only for global ticker drain', () => {
    expect(defaultProductionOnlyForDrain()).toBe(true)
    expect(defaultProductionOnlyForDrain({})).toBe(true)
  })

  it('allows harness jobs when draining a specific user (manual run)', () => {
    expect(defaultProductionOnlyForDrain({ userId: 'harness-user' })).toBe(false)
  })

  it('honors an explicit productionOnly override', () => {
    expect(defaultProductionOnlyForDrain({ userId: 'u1', productionOnly: true })).toBe(true)
    expect(defaultProductionOnlyForDrain({ productionOnly: false })).toBe(false)
  })
})
