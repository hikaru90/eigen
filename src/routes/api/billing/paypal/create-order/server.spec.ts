import { describe, expect, it, vi } from 'vitest'
import { computeTopUpCheckout } from '$lib/billing/top-up-checkout'
import { MIN_TOP_UP_CREDITS } from '$lib/server/billing/credits'
import { POST } from './+server'

const { createPayPalOrderMock, getDbMock } = vi.hoisted(() => ({
  createPayPalOrderMock: vi.fn(),
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/billing/paypal', () => ({
  createPayPalOrder: createPayPalOrderMock,
}))
vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

function postRequest(body: unknown) {
  return new Request('http://localhost/api/billing/paypal/create-order', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/billing/paypal/create-order', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await POST({
      locals: { user: null },
      request: postRequest({ amountCredits: MIN_TOP_UP_CREDITS }),
    } as never)
    expect(res.status).toBe(401)
  })

  it('returns 400 when amountCredits is below minimum', async () => {
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: MIN_TOP_UP_CREDITS - 1 }),
    } as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/at least/)
  })

  it('returns 400 when amountCredits exceeds maximum', async () => {
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: 5_000_001 }),
    } as never)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot exceed/)
  })

  it('creates PayPal order at quoted total and persists pricing breakdown', async () => {
    const quote = computeTopUpCheckout(MIN_TOP_UP_CREDITS)
    createPayPalOrderMock.mockResolvedValue({
      id: 'pp-order-1',
      status: 'CREATED',
      grossPayPalValue: quote.paypalAmount,
    })
    const returning = vi.fn().mockResolvedValue([{ id: 'internal-1' }])
    const values = vi.fn().mockReturnValue({ returning })
    const insert = vi.fn().mockReturnValue({ values })
    getDbMock.mockReturnValue({ insert })

    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: postRequest({ amountCredits: MIN_TOP_UP_CREDITS }),
    } as never)

    expect(createPayPalOrderMock).toHaveBeenCalledWith({ amountCredits: MIN_TOP_UP_CREDITS })
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        requestedCredits: MIN_TOP_UP_CREDITS,
        chargedGrossUsd: quote.totalDueUsd,
        platformSubtotalUsd: quote.platformSubtotalUsd,
        estimatedPaypalFeeUsd: quote.paypalFeeUsd,
      }),
    )
    const body = await res.json()
    expect(body).toEqual({
      orderId: 'pp-order-1',
      internalOrderId: 'internal-1',
      status: 'CREATED',
      amountCredits: MIN_TOP_UP_CREDITS,
      checkout: {
        baseUsd: quote.baseUsd,
        markupUsd: quote.markupUsd,
        platformSubtotalUsd: quote.platformSubtotalUsd,
        paypalFeeUsd: quote.paypalFeeUsd,
        totalDueUsd: quote.totalDueUsd,
        paypalAmount: quote.paypalAmount,
      },
    })
  })
})
