import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { getDb } from '$lib/server/db'
import { paymentOrder } from '$lib/server/db/schema'
import { createPayPalOrder } from '$lib/server/billing/paypal'
import { computeTopUpCheckout } from '$lib/server/billing/checkout-pricing'
import { MIN_TOP_UP_CREDITS } from '$lib/server/billing/credits'
import { captureServerEvent } from '$lib/server/analytics/posthog-server'

const MAX_TOP_UP_CREDITS = 5_000_000 // $5000 USD at 1000 credits per dollar

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await event.request.json().catch(() => null)
  const amountCredits =
    typeof body?.amountCredits === 'number'
      ? body.amountCredits
      : typeof body?.amountCredits === 'string'
        ? Number(body.amountCredits)
        : NaN

  if (!Number.isInteger(amountCredits) || amountCredits < MIN_TOP_UP_CREDITS) {
    captureServerEvent({
      distinctId: user.id,
      event: 'billing_order_create_failed',
      properties: {
        amount_credits: Number.isFinite(amountCredits) ? amountCredits : null,
        error_message: `amountCredits must be an integer of at least ${MIN_TOP_UP_CREDITS}`,
      },
    })
    return json(
      { error: `amountCredits must be an integer of at least ${MIN_TOP_UP_CREDITS}` },
      { status: 400 },
    )
  }
  if (amountCredits > MAX_TOP_UP_CREDITS) {
    captureServerEvent({
      distinctId: user.id,
      event: 'billing_order_create_failed',
      properties: {
        amount_credits: amountCredits,
        error_message: `amountCredits cannot exceed ${MAX_TOP_UP_CREDITS}`,
      },
    })
    return json({ error: `amountCredits cannot exceed ${MAX_TOP_UP_CREDITS}` }, { status: 400 })
  }

  try {
    const quote = computeTopUpCheckout(amountCredits)
    const paypalOrder = await createPayPalOrder({ amountCredits })

    const db = getDb()
    const [row] = await db
      .insert(paymentOrder)
      .values({
        userId: user.id,
        paypalOrderId: paypalOrder.id,
        status: 'created',
        requestedCredits: amountCredits,
        chargedGrossUsd: quote.totalDueUsd,
        platformSubtotalUsd: quote.platformSubtotalUsd,
        estimatedPaypalFeeUsd: quote.paypalFeeUsd,
        currency: 'USD',
      })
      .returning({ id: paymentOrder.id })

    captureServerEvent({
      distinctId: user.id,
      event: 'billing_order_created',
      properties: {
        amount_credits: amountCredits,
        internal_order_id: row.id,
        paypal_order_id: paypalOrder.id,
        charged_gross_usd: quote.totalDueUsd,
        platform_subtotal_usd: quote.platformSubtotalUsd,
        estimated_paypal_fee_usd: quote.paypalFeeUsd,
      },
    })

    return json({
      orderId: paypalOrder.id,
      internalOrderId: row.id,
      status: paypalOrder.status,
      amountCredits,
      checkout: {
        baseUsd: quote.baseUsd,
        markupUsd: quote.markupUsd,
        platformSubtotalUsd: quote.platformSubtotalUsd,
        paypalFeeUsd: quote.paypalFeeUsd,
        totalDueUsd: quote.totalDueUsd,
        paypalAmount: quote.paypalAmount,
      },
    })
  } catch (error) {
    captureServerEvent({
      distinctId: user.id,
      event: 'billing_order_create_failed',
      properties: {
        amount_credits: amountCredits,
        error_message: errorMessage(error),
      },
    })
    throw error
  }
}
