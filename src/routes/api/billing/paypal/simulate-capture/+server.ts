import type { RequestHandler } from './$types'
import { randomUUID } from 'node:crypto'
import { json } from '@sveltejs/kit'
import { captureServerEvent } from '$lib/server/analytics/posthog-server'
import { isUserAdmin } from '$lib/server/auth/user-role'
import { computeTopUpCheckout } from '$lib/server/billing/checkout-pricing'
import { CREDITS_PER_USD, MIN_TOP_UP_CREDITS } from '$lib/server/billing/credits'
import { maybeEnqueueErpNextInvoicePush } from '$lib/server/billing/erpnext-invoice-push'
import { creditFromPayment } from '$lib/server/billing/wallet'
import { getDb } from '$lib/server/db'
import { paymentOrder } from '$lib/server/db/schema'
import { env } from '$lib/server/env/private-env'

function isPayPalSandboxMode(): boolean {
  return (env.PAYPAL_API_BASE ?? '').toLowerCase().includes('sandbox')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fallbackPayerEmail(): string {
  return `simulated-buyer-${randomUUID().slice(0, 8)}@example.com`
}

/**
 * Simulates a verified PayPal capture through the real production code path
 * (order + pricing + wallet credit + ERPNext invoice push enqueue).
 *
 * Hard guards: admin session AND PayPal sandbox mode — never runnable against live PayPal,
 * so it can never touch a real payment or the real ERPNext beyond what a sandbox test would.
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) {
    return json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await isUserAdmin(user.id))) {
    return json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!isPayPalSandboxMode()) {
    return json(
      { error: 'Simulation is only allowed when PayPal is configured for sandbox mode' },
      { status: 403 },
    )
  }

  const body = await event.request.json().catch(() => null)
  const amountCredits =
    typeof body?.amountCredits === 'number'
      ? body.amountCredits
      : typeof body?.amountCredits === 'string'
        ? Number(body.amountCredits)
        : NaN
  if (!Number.isInteger(amountCredits) || amountCredits < MIN_TOP_UP_CREDITS) {
    return json(
      { error: `amountCredits must be an integer of at least ${MIN_TOP_UP_CREDITS}` },
      { status: 400 },
    )
  }
  const payerEmail =
    typeof body?.payerEmail === 'string' && body.payerEmail.trim()
      ? body.payerEmail.trim()
      : fallbackPayerEmail()

  const quote = computeTopUpCheckout(amountCredits)
  const paypalOrderId = `SANDBOX-SIM-${randomUUID()}`
  const netUsd = (Number(quote.totalDueUsd) - Number(quote.paypalFeeUsd)).toFixed(2)

  const db = getDb()
  const [row] = await db
    .insert(paymentOrder)
    .values({
      userId: user.id,
      paypalOrderId,
      status: 'approved',
      requestedCredits: amountCredits,
      chargedGrossUsd: quote.totalDueUsd,
      platformSubtotalUsd: quote.platformSubtotalUsd,
      estimatedPaypalFeeUsd: quote.paypalFeeUsd,
      actualPaypalFeeUsd: quote.paypalFeeUsd,
      netReceivedUsd: netUsd,
      currency: 'USD',
      payerEmail,
    })
    .returning({ id: paymentOrder.id })

  const result = await creditFromPayment({
    userId: user.id,
    paymentOrderId: row.id,
    paypalOrderId,
    amountCredits,
    audit: {
      grossUsd: quote.totalDueUsd,
      netUsd,
      paypalFeeUsd: quote.paypalFeeUsd,
      platformSubtotalUsd: quote.platformSubtotalUsd,
    },
  })

  let erpNextPush: Awaited<ReturnType<typeof maybeEnqueueErpNextInvoicePush>> = {
    enqueued: false,
    reason: 'disabled',
  }
  let erpNextEnqueueError: string | null = null
  try {
    erpNextPush = await maybeEnqueueErpNextInvoicePush({
      userId: user.id,
      paymentOrderId: row.id,
      payerEmail,
    })
  } catch (error) {
    erpNextEnqueueError = errorMessage(error)
  }

  captureServerEvent({
    distinctId: user.id,
    event: 'billing_order_captured',
    properties: {
      paypal_order_id: paypalOrderId,
      internal_order_id: row.id,
      amount_credits: amountCredits,
      credited: result.credited,
      available_credits: result.availableCredits,
      gross_usd: quote.totalDueUsd,
      paypal_fee_usd: quote.paypalFeeUsd,
      net_received_usd: netUsd,
      platform_subtotal_usd: quote.platformSubtotalUsd,
      simulated: true,
      erpnext_invoice_push: erpNextPush.enqueued ? 'enqueued' : erpNextPush.reason,
      ...(erpNextEnqueueError ? { erpnext_enqueue_error: erpNextEnqueueError } : {}),
    },
  })

  return json({
    status: 'captured',
    simulated: true,
    orderId: paypalOrderId,
    internalOrderId: row.id,
    credited: result.credited,
    availableCredits: result.availableCredits,
    creditedCredits: amountCredits,
    creditsPerUsd: CREDITS_PER_USD,
    payerEmail,
    checkout: {
      grossUsd: quote.totalDueUsd,
      paypalFeeUsd: quote.paypalFeeUsd,
      netUsd,
    },
    erpnext: erpNextPush,
  })
}
