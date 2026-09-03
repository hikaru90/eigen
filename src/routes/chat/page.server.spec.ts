import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkCaptureAllowedMock, isByokBillingMock, getWalletSnapshotMock } = vi.hoisted(() => ({
  checkCaptureAllowedMock: vi.fn(),
  isByokBillingMock: vi.fn(),
  getWalletSnapshotMock: vi.fn(),
}))

vi.mock('$lib/server/onboarding/capture-gate', () => ({
  checkCaptureAllowed: checkCaptureAllowedMock,
}))
vi.mock('$lib/server/billing/preferences', () => ({
  isByokBilling: isByokBillingMock,
}))
vi.mock('$lib/server/billing/wallet', () => ({
  getWalletSnapshot: getWalletSnapshotMock,
}))

import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { load } from './+page.server'

describe('chat page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkCaptureAllowedMock.mockResolvedValue({ allowed: true })
    isByokBillingMock.mockResolvedValue(false)
    getWalletSnapshotMock.mockResolvedValue({
      availableCredits: 0,
      reservedCredits: 0,
      pendingBillingMicroUsd: 0,
    })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns capture gate and wallet shape without throwing when authenticated', async () => {
    const result = await load({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
    } as never)

    expect(result.captureGate).toEqual({ allowed: true })
    expect(result.billingMode).toBe('platform_credits')
    expect(result.walletAvailableCredits).toBe(0)
    expect(result.minCaptureCredits).toBe(MIN_CAPTURE_PIPELINE_CREDITS)
    expect(checkCaptureAllowedMock).toHaveBeenCalledWith('u1')
    expect(isByokBillingMock).toHaveBeenCalledWith('u1')
    expect(getWalletSnapshotMock).toHaveBeenCalledWith('u1')
  })
})
