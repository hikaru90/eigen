import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockIsPayPalConfigured } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  mockIsPayPalConfigured: vi.fn(() => false),
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))

vi.mock('$lib/server/billing/paypal', () => ({
  isPayPalConfigured: mockIsPayPalConfigured,
}))

describe('isByokUiEnabled', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete mockEnv[key]
    }
    mockIsPayPalConfigured.mockReset()
    mockIsPayPalConfigured.mockReturnValue(false)
  })

  it('returns true when env is unset and PayPal is not configured', async () => {
    const { isByokUiEnabled } = await import('./byok-ui')
    expect(isByokUiEnabled()).toBe(true)
  })

  it('returns false when env is unset and PayPal is configured', async () => {
    mockIsPayPalConfigured.mockReturnValue(true)
    const { isByokUiEnabled } = await import('./byok-ui')
    expect(isByokUiEnabled()).toBe(false)
  })

  it('returns false for explicit false', async () => {
    mockEnv.BILLING_BYOK_UI_ENABLED = 'false'
    const { isByokUiEnabled } = await import('./byok-ui')
    expect(isByokUiEnabled()).toBe(false)
  })

  it('returns true when BILLING_BYOK_UI_ENABLED=true even if PayPal is configured', async () => {
    mockEnv.BILLING_BYOK_UI_ENABLED = 'true'
    mockIsPayPalConfigured.mockReturnValue(true)
    const { isByokUiEnabled } = await import('./byok-ui')
    expect(isByokUiEnabled()).toBe(true)
  })
})
