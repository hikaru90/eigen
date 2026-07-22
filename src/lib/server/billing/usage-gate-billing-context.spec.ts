import { describe, expect, it, vi, beforeEach } from 'vitest'
import { billingUserAsyncLocal } from './context'
import { MIN_CAPTURE_PIPELINE_CREDITS } from './usage-gate'

const { isByokBillingMock, assertCanAffordMock } = vi.hoisted(() => ({
  isByokBillingMock: vi.fn(async () => false),
  assertCanAffordMock: vi.fn(async () => undefined),
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
  assertCanAfford: assertCanAffordMock,
  assertHasPlatformCredits: vi.fn(),
  chargePlatformUsageMicroUsd: vi.fn(),
  InsufficientCreditsError: class extends Error {
    name = 'InsufficientCreditsError'
  },
}))

describe('assertCapturePipelineAffordable billing user', () => {
  beforeEach(() => {
    isByokBillingMock.mockReset()
    assertCanAffordMock.mockReset()
    isByokBillingMock.mockResolvedValue(false)
  })

  it('checks wallet for billing override user, not eval tenant', async () => {
    const { assertCapturePipelineAffordable } = await import('./usage-gate')
    await billingUserAsyncLocal.run('operator-99', async () => {
      await assertCapturePipelineAffordable('eval-run-user')
    })
    expect(assertCanAffordMock).toHaveBeenCalledWith('operator-99', MIN_CAPTURE_PIPELINE_CREDITS)
    expect(isByokBillingMock).toHaveBeenCalledWith('operator-99')
  })

  it('checks harness corpus operator wallet without billingUserAsyncLocal', async () => {
    const { assertCapturePipelineAffordable } = await import('./usage-gate')
    await assertCapturePipelineAffordable('graph-scale-corpus-run-uuid-1')
    expect(assertCanAffordMock).toHaveBeenCalledWith(
      'graph-scale-runner',
      MIN_CAPTURE_PIPELINE_CREDITS,
    )
  })
})
