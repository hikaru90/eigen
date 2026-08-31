import { eq } from 'drizzle-orm'
import {
  loadErpNextConfig,
  pushErpNextInvoice,
} from '$lib/server/billing/erpnext'
import { withDbUser, getDb } from '$lib/server/db'
import { paymentOrder, user, type UserJobQueue } from '$lib/server/db/schema'
import { createAdminSql } from '$lib/server/job-queue/admin-db'
import { enqueueUserJob } from '$lib/server/job-queue/enqueue'

export const ERPNEXT_INVOICE_PUSH_JOB = 'erpnext_invoice_push' as const
export const ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX = 'erpnext_invoice:'
const ERPNEXT_BACKFILL_DEFAULT_LIMIT = 200

export type MaybeEnqueueErpNextInvoicePushResult =
  | { enqueued: true }
  | {
      enqueued: false
      reason: 'disabled' | 'missing_payer_email' | 'harness_account' | 'duplicate'
    }

/**
 * Enqueue the ERPNext invoice push after a verified capture.
 *
 * Guardrails: only production accounts with a PayPal payer email are invoiced
 * (harness/eval captures must never create ERPNext documents).
 */
export async function maybeEnqueueErpNextInvoicePush(input: {
  userId: string
  paymentOrderId: string
  payerEmail: string | null
}): Promise<MaybeEnqueueErpNextInvoicePushResult> {
  if (!loadErpNextConfig()) {
    return { enqueued: false, reason: 'disabled' }
  }
  if (!input.payerEmail?.trim()) {
    return { enqueued: false, reason: 'missing_payer_email' }
  }

  const account = await withDbUser(input.userId, async (db) => {
    const [row] = await db
      .select({ accountKind: user.accountKind })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1)
    return row
  })
  if (account?.accountKind !== 'production') {
    return { enqueued: false, reason: 'harness_account' }
  }

  const result = await enqueueUserJob({
    userId: input.userId,
    jobType: ERPNEXT_INVOICE_PUSH_JOB,
    runAfter: new Date(),
    dedupeKey: `${ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX}${input.paymentOrderId}`,
    payload: { paymentOrderId: input.paymentOrderId },
    maxAttempts: 3,
  })
  return result.enqueued ? { enqueued: true } : { enqueued: false, reason: 'duplicate' }
}

function readPaymentOrderId(payload: Record<string, unknown>): string {
  const id = typeof payload.paymentOrderId === 'string' ? payload.paymentOrderId.trim() : ''
  if (!id) {
    throw new Error('erpnext_invoice_push job payload requires paymentOrderId')
  }
  return id
}

export type ProcessErpNextInvoicePushResult =
  | { skipped: true; invoiceName: string }
  | { skipped: false; invoiceName: string }

/** Push one captured payment order to ERPNext as a draft Sales Invoice (idempotent per order). */
export async function processErpNextInvoicePushJob(
  job: Pick<UserJobQueue, 'userId' | 'payload'>,
): Promise<ProcessErpNextInvoicePushResult> {
  const paymentOrderId = readPaymentOrderId(job.payload)

  const config = loadErpNextConfig()
  if (!config) {
    throw new Error(
      'ERPNext invoice push failed: ERPNEXT_* env vars are not configured (set ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET, ERPNEXT_COMPANY, ERPNEXT_ITEM_CODE)',
    )
  }

  const db = getDb()
  const [order] = await db
    .select()
    .from(paymentOrder)
    .where(eq(paymentOrder.id, paymentOrderId))
    .limit(1)

  if (!order || order.userId !== job.userId) {
    throw new Error(`Payment order ${paymentOrderId} not found for ERPNext invoice push`)
  }
  if (order.erpNextInvoiceName) {
    return { skipped: true, invoiceName: order.erpNextInvoiceName }
  }
  if (order.status !== 'captured') {
    throw new Error(
      `Payment order ${paymentOrderId} is not captured (status: ${order.status}); refusing to invoice`,
    )
  }
  if (!order.payerEmail?.trim()) {
    throw new Error(`Payment order ${paymentOrderId} has no PayPal payer email; cannot invoice`)
  }

  const result = await pushErpNextInvoice(config, {
    paypalOrderId: order.paypalOrderId,
    requestedCredits: order.requestedCredits,
    chargedGrossUsd: order.chargedGrossUsd,
    currency: order.currency,
    payerEmail: order.payerEmail,
    updatedAt: order.updatedAt,
    createdAt: order.createdAt,
  })

  await db
    .update(paymentOrder)
    .set({
      erpNextInvoiceName: result.invoiceName,
      erpNextSyncedAt: new Date(),
    })
    .where(eq(paymentOrder.id, order.id))

  return { skipped: false, invoiceName: result.invoiceName }
}

export type ErpNextBackfillResult = {
  matched: number
  enqueued: number
  duplicates: number
  disabled: boolean
}

/** Enqueue pushes for captured production payments that have no ERPNext invoice yet. */
export async function enqueueErpNextInvoiceBackfill(
  options?: { limit?: number },
): Promise<ErpNextBackfillResult> {
  if (!loadErpNextConfig()) {
    return { matched: 0, enqueued: 0, duplicates: 0, disabled: true }
  }

  const limit = options?.limit ?? ERPNEXT_BACKFILL_DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('ERPNext backfill limit must be a positive integer')
  }

  const sql = createAdminSql(1)
  try {
    const rows = await sql<Array<{ id: string; user_id: string }>>`
			SELECT po.id, po.user_id
			FROM payment_order po
			INNER JOIN "user" u ON u.id = po.user_id
			WHERE po.status = 'captured'
				AND po.erpnext_invoice_name IS NULL
				AND po.payer_email IS NOT NULL
				AND u.account_kind = 'production'
			ORDER BY po.updated_at ASC
			LIMIT ${limit}
		`

    let enqueued = 0
    let duplicates = 0
    for (const row of rows) {
      const result = await enqueueUserJob({
        userId: row.user_id,
        jobType: ERPNEXT_INVOICE_PUSH_JOB,
        runAfter: new Date(),
        dedupeKey: `${ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX}${row.id}`,
        payload: { paymentOrderId: row.id },
        maxAttempts: 3,
      })
      if (result.enqueued) {
        enqueued += 1
      } else {
        duplicates += 1
      }
    }

    return { matched: rows.length, enqueued, duplicates, disabled: false }
  } finally {
    await sql.end()
  }
}

export type ErpNextSyncStatus = {
  configured: boolean
  uninvoicedCount: number
  invoicedCount: number
  failedJobCount: number
}

/** Admin visibility: how many captured payments still need an ERPNext invoice. */
export async function loadErpNextSyncStatus(): Promise<ErpNextSyncStatus> {
  if (!loadErpNextConfig()) {
    return { configured: false, uninvoicedCount: 0, invoicedCount: 0, failedJobCount: 0 }
  }

  const sql = createAdminSql(1)
  try {
    const [counts] = await sql<Array<{ uninvoiced: number; invoiced: number }>>`
			SELECT
				COUNT(*) FILTER (
					WHERE po.status = 'captured'
						AND po.erpnext_invoice_name IS NULL
						AND po.payer_email IS NOT NULL
						AND u.account_kind = 'production'
				)::int AS uninvoiced,
				COUNT(*) FILTER (
					WHERE po.erpnext_invoice_name IS NOT NULL
						AND u.account_kind = 'production'
				)::int AS invoiced
			FROM payment_order po
			INNER JOIN "user" u ON u.id = po.user_id
		`
    const [failed] = await sql<Array<{ failed: number }>>`
			SELECT COUNT(*)::int AS failed
			FROM user_job_queue
			WHERE job_type = ${ERPNEXT_INVOICE_PUSH_JOB}
				AND status = 'failed'
		`

    return {
      configured: true,
      uninvoicedCount: counts?.uninvoiced ?? 0,
      invoicedCount: counts?.invoiced ?? 0,
      failedJobCount: failed?.failed ?? 0,
    }
  } finally {
    await sql.end()
  }
}
