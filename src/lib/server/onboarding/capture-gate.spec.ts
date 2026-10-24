import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate'

const { getOrCreateWalletMock, isHarnessUserMock } = vi.hoisted(() => ({
  getOrCreateWalletMock: vi.fn(),
  isHarnessUserMock: vi.fn(),
}))

vi.mock('$lib/server/billing/wallet', () => ({
  getOrCreateWallet: getOrCreateWalletMock,
}))

vi.mock('$lib/server/auth/harness-account', () => ({
  isHarnessUser: isHarnessUserMock,
}))

describe('checkCaptureAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isHarnessUserMock.mockResolvedValue(false)
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 100 })
  })

  it('allows capture without any grounding profile', async () => {
    const gate = await checkCaptureAllowed('u1')
    expect(gate).toEqual({ allowed: true })
  })

  it('blocks platform users with low credits', async () => {
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 4 })
    const gate = await checkCaptureAllowed('u1')
    expect(gate).toEqual({ allowed: false, reason: 'insufficient_credits' })
  })

  it('blocks an empty wallet — there is no bring-your-own-key bypass', async () => {
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 0 })
    const gate = await checkCaptureAllowed('u1')
    expect(gate).toEqual({ allowed: false, reason: 'insufficient_credits' })
  })

  it('allows platform users with enough credits', async () => {
    const gate = await checkCaptureAllowed('u1')
    expect(gate).toEqual({ allowed: true })
  })

  it('allows harness tenants without wallet credits', async () => {
    isHarnessUserMock.mockResolvedValue(true)
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 0 })
    const gate = await checkCaptureAllowed('graph-scale-corpus-run-1')
    expect(gate).toEqual({ allowed: true })
    expect(getOrCreateWalletMock).not.toHaveBeenCalled()
  })
})
