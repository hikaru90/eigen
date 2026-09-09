import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  isUserAdminMock,
  creditFromPaymentMock,
  getOrCreateWalletMock,
  maybeEnqueueMock,
  captureServerEventMock,
  mockEnv,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  isUserAdminMock: vi.fn(),
  creditFromPaymentMock: vi.fn(),
  getOrCreateWalletMock: vi.fn(),
  maybeEnqueueMock: vi.fn(),
  captureServerEventMock: vi.fn(),
  mockEnv: {} as Record<string, string | undefined>,
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))
vi.mock('$lib/server/auth/user-role', () => ({
  isUserAdmin: isUserAdminMock,
}))
vi.mock('$lib/server/billing/wallet', () => ({
  creditFromPayment: creditFromPaymentMock,
  getOrCreateWallet: getOrCreateWalletMock,
}))
vi.mock('$lib/server/billing/erpnext-invoice-push', () => ({
  maybeEnqueueErpNextInvoicePush: maybeEnqueueMock,
}))
vi.mock('$lib/server/analytics/posthog-server', () => ({
  captureServerEvent: captureServerEventMock,
}))
vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

import { computeTopUpCheckout } from '$lib/server/billing/checkout-pricing'
import { POST } from './+server'

const QUOTE = computeTopUpCheckout(1000)

function postRequest(body: unknown) {
  return new Request('http://localhost/api/billing/paypal/simulate-capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function buildInsertDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'internal-1' }])
  const values = vi.fn().mockReturnValue({ returning })
  const insert = vi.fn().mockReturnValue({ values })
  getDbMock.mockReturnValue({ insert })
  return { insert, values, returning }
}

describe('POST /api/billing/paypal/simulate-capture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(mockEnv)) delete mockEnv[key]
    mockEnv.PAYPAL_API_BASE = 'https://api-m.sandbox.paypal.com'
    isUserAdminMock.mockResolvedValue(true)
    creditFromPaymentMock.mockResolvedValue({ credited: true, availableCredits: 11000 })
    getOrCreateWalletMock.mockResolvedValue({ availableCredits: 11000 })
    maybeEnqueueMock.mockResolvedValue({ enqueued: true })
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await POST({ locals: { user: null }, request: postRequest({ amountCredits: 1000 }) } as never)
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin users', async () => {
    isUserAdminMock.mockResolvedValue(false)
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 1000 }),
    } as never)
    expect(res.status).toBe(403)
  })

  it('refuses to run when PayPal is not in sandbox mode', async () => {
    mockEnv.PAYPAL_API_BASE = 'https://api-m.paypal.com'
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 1000 }),
    } as never)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/sandbox/)
    expect(getDbMock).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid amountCredits', async () => {
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 500 }),
    } as never)
    expect(res.status).toBe(400)
  })

  it('creates an approved order, credits the wallet, and enqueues the ERPNext push', async () => {
    const { values } = buildInsertDb()

    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 1000, payerEmail: 'buyer@example.com' }),
    } as never)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'captured',
      simulated: true,
      credited: true,
      availableCredits: 11000,
      creditedCredits: 1000,
      internalOrderId: 'internal-1',
      erpnext: { enqueued: true },
      checkout: {
        grossUsd: QUOTE.totalDueUsd,
        paypalFeeUsd: QUOTE.paypalFeeUsd,
      },
    })
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        status: 'approved',
        currency: 'USD',
        requestedCredits: 1000,
        chargedGrossUsd: QUOTE.totalDueUsd,
        platformSubtotalUsd: QUOTE.platformSubtotalUsd,
        estimatedPaypalFeeUsd: QUOTE.paypalFeeUsd,
        payerEmail: 'buyer@example.com',
      }),
    )
    expect(values.mock.calls[0][0].paypalOrderId).toMatch(/^SANDBOX-SIM-/)
    expect(creditFromPaymentMock).toHaveBeenCalledWith({
      userId: 'u1',
      paymentOrderId: 'internal-1',
      paypalOrderId: expect.stringMatching(/^SANDBOX-SIM-/),
      amountCredits: 1000,
      audit: expect.objectContaining({
        grossUsd: QUOTE.totalDueUsd,
        paypalFeeUsd: QUOTE.paypalFeeUsd,
      }),
    })
    expect(maybeEnqueueMock).toHaveBeenCalledWith({
      userId: 'u1',
      paymentOrderId: 'internal-1',
      payerEmail: 'buyer@example.com',
    })
    expect(captureServerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'billing_order_captured',
        properties: expect.objectContaining({ simulated: true }),
      }),
    )
  })

  it('generates a fallback payer email when none is given', async () => {
    const { values } = buildInsertDb()
    await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 1000 }),
    } as never)
    const payer = values.mock.calls[0][0].payerEmail as string
    expect(payer).toMatch(/^simulated-buyer-[0-9a-f]{8}@example\.com$/)
    expect(maybeEnqueueMock).toHaveBeenCalledWith({
      userId: 'u1',
      paymentOrderId: 'internal-1',
      payerEmail: payer,
    })
  })

  it('still returns success when the ERPNext enqueue throws', async () => {
    buildInsertDb()
    maybeEnqueueMock.mockRejectedValue(new Error('db down'))
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 1000 }),
    } as never)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('captured')
  })
})
