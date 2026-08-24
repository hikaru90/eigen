import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MICRO_USD_PER_CREDIT } from './credits'
import { MICRO_USD_PER_CENT } from './money'
import { billedMicroUsdFromBaseUsd, MIN_CAPTURE_PIPELINE_CREDITS } from './usage-gate'

const { isByokBillingMock, chargePlatformUsageMicroUsdMock } = vi.hoisted(() => ({
  isByokBillingMock: vi.fn(async () => false),
  chargePlatformUsageMicroUsdMock: vi.fn(async () => 0),
}))

vi.mock('$lib/server/billing/preferences', () => ({
  isByokBilling: isByokBillingMock,
}))

vi.mock('$lib/server/billing/ensure-harness-credits', () => ({
  ensureHarnessWalletCredits: vi.fn(async () => ({
    billingUserId: 'graph-scale-runner',
    availableCredits: 500_000,
  })),
}))

vi.mock('$lib/server/billing/wallet', () => ({
  assertCanAfford: vi.fn(async () => undefined),
  assertHasPlatformCredits: vi.fn(async () => ({
    availableCredits: 1000,
    reservedCredits: 0,
    pendingBillingMicroUsd: 0,
  })),
  chargePlatformUsageMicroUsd: chargePlatformUsageMicroUsdMock,
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    name = 'InsufficientCreditsError'
  },
}))

describe('usage-gate billing', () => {
  beforeEach(() => {
    isByokBillingMock.mockReset()
    isByokBillingMock.mockResolvedValue(false)
    chargePlatformUsageMicroUsdMock.mockReset()
    chargePlatformUsageMicroUsdMock.mockResolvedValue(0)
  })

  it('MIN_CAPTURE_PIPELINE_CREDITS is a positive integer', () => {
    expect(MIN_CAPTURE_PIPELINE_CREDITS).toBe(5)
    expect(Number.isInteger(MIN_CAPTURE_PIPELINE_CREDITS)).toBe(true)
  })
  it('accumulates sub-cent settled costs instead of rounding up to 1 cent', () => {
    const micro = billedMicroUsdFromBaseUsd(0.0001)
    expect(micro).toBeGreaterThan(0)
    expect(micro).toBeLessThan(MICRO_USD_PER_CENT)
  })

  it('returns 0 micro-USD for zero base cost', () => {
    expect(billedMicroUsdFromBaseUsd(0)).toBe(0)
  })

  it('assertCapturePipelineAffordable calls assertCanAfford for platform credits', async () => {
    const { assertCapturePipelineAffordable } = await import('./usage-gate')
    const { assertCanAfford } = await import('./wallet')
    await assertCapturePipelineAffordable('user-1')
    expect(assertCanAfford).toHaveBeenCalledWith('user-1', MIN_CAPTURE_PIPELINE_CREDITS)
  })

  it('MICRO_USD_PER_CREDIT matches one millicent of USD per credit', () => {
    expect(MICRO_USD_PER_CREDIT).toBe(1000)
  })

  it('withPlatformBilling charges wallet from gateway cost (gateway-agnostic)', async () => {
    const { withPlatformBilling } = await import('./usage-gate')
    const result = await withPlatformBilling(
      'user-1',
      () => 0.01,
      async () => ({ usage: { cost: 0.01 } }),
    )
    expect(result).toEqual({ usage: { cost: 0.01 } })
    expect(chargePlatformUsageMicroUsdMock).toHaveBeenCalledWith(
      'user-1',
      billedMicroUsdFromBaseUsd(0.01),
      expect.objectContaining({ baseUsd: 0.01 }),
    )
  })
})
