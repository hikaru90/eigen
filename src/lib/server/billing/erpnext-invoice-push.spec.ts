import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  enqueueUserJobMock,
  withDbUserMock,
  getDbMock,
  createAdminSqlMock,
  sqlEndMock,
  fetchMock,
  mockEnv,
} = vi.hoisted(() => ({
  enqueueUserJobMock: vi.fn(),
  withDbUserMock: vi.fn(),
  getDbMock: vi.fn(),
  createAdminSqlMock: vi.fn(),
  sqlEndMock: vi.fn(),
  fetchMock: vi.fn(),
  mockEnv: {} as Record<string, string | undefined>,
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))

vi.mock('$lib/server/job-queue/enqueue', () => ({
  enqueueUserJob: enqueueUserJobMock,
}))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
  getDb: getDbMock,
}))

vi.mock('$lib/server/job-queue/admin-db', () => ({
  createAdminSql: createAdminSqlMock,
}))

vi.stubGlobal('fetch', fetchMock)

function clearEnv() {
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key]
  }
}

import type { UserJobQueue } from '$lib/server/db/schema'
import {
  enqueueErpNextInvoiceBackfill,
  ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX,
  loadErpNextSyncStatus,
  maybeEnqueueErpNextInvoicePush,
  processErpNextInvoicePushJob,
} from './erpnext-invoice-push'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubErpNextEnv() {
  mockEnv.ERPNEXT_BASE_URL = 'https://erp.example.com'
  mockEnv.ERPNEXT_API_KEY = 'key-123'
  mockEnv.ERPNEXT_API_SECRET = 'secret-456'
  mockEnv.ERPNEXT_COMPANY = 'Buck'
  mockEnv.ERPNEXT_ITEM_CODE = 'EIGEN-CREDITS'
}

function buildSelectDb(rows: unknown[]) {
  const selectLimit = vi.fn().mockResolvedValue(rows)
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit })
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere })
  const select = vi.fn().mockReturnValue({ from: selectFrom })

  const updateWhere = vi.fn().mockResolvedValue(undefined)
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere })
  const update = vi.fn().mockReturnValue({ set: updateSet })

  getDbMock.mockReturnValue({ select, update })
  return { select, update, updateSet, updateWhere }
}

function jobFixture(overrides: Partial<UserJobQueue> = {}): UserJobQueue {
  return {
    id: 'job-1',
    userId: 'u1',
    jobType: 'erpnext_invoice_push',
    status: 'running',
    payload: { paymentOrderId: 'order-1' },
    runAfter: new Date(),
    dedupeKey: `${ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX}order-1`,
    attemptCount: 1,
    maxAttempts: 3,
    lastError: null,
    heartbeatRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
    ...overrides,
  } as UserJobQueue
}

function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'u1',
    paypalOrderId: 'PP-ORDER-1',
    status: 'captured' as const,
    requestedCredits: 1000,
    capturedCredits: 1000,
    chargedGrossUsd: '1.75',
    platformSubtotalUsd: '1.20',
    estimatedPaypalFeeUsd: '0.55',
    actualPaypalFeeUsd: '0.54',
    netReceivedUsd: '1.21',
    currency: 'USD',
    payerEmail: 'payer@example.com',
    rawCapture: {},
    createdAt: new Date('2026-08-30T10:00:00Z'),
    updatedAt: new Date('2026-08-31T09:30:00Z'),
    erpNextInvoiceName: null,
    erpNextSyncedAt: null,
    ...overrides,
  }
}

describe('maybeEnqueueErpNextInvoicePush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEnv()
    fetchMock.mockReset()
  })

  it('does not enqueue when ERPNext is not configured', async () => {
    const result = await maybeEnqueueErpNextInvoicePush({
      userId: 'u1',
      paymentOrderId: 'order-1',
      payerEmail: 'payer@example.com',
    })

    expect(result).toEqual({ enqueued: false, reason: 'disabled' })
    expect(enqueueUserJobMock).not.toHaveBeenCalled()
  })

  it('does not enqueue when no PayPal payer email is present', async () => {
    stubErpNextEnv()
    const result = await maybeEnqueueErpNextInvoicePush({
      userId: 'u1',
      paymentOrderId: 'order-1',
      payerEmail: null,
    })

    expect(result).toEqual({ enqueued: false, reason: 'missing_payer_email' })
    expect(enqueueUserJobMock).not.toHaveBeenCalled()
  })

  it('does not enqueue for harness accounts', async () => {
    stubErpNextEnv()
    withDbUserMock.mockImplementation(async (_uid: string, fn: (db: unknown) => unknown) =>
      fn({
        select: vi
          .fn()
          .mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ accountKind: 'harness' }]),
              }),
            }),
          }),
      }),
    )

    const result = await maybeEnqueueErpNextInvoicePush({
      userId: 'u1',
      paymentOrderId: 'order-1',
      payerEmail: 'payer@example.com',
    })

    expect(result).toEqual({ enqueued: false, reason: 'harness_account' })
    expect(enqueueUserJobMock).not.toHaveBeenCalled()
  })

  it('enqueues with a per-order dedupe key for production accounts', async () => {
    stubErpNextEnv()
    withDbUserMock.mockImplementation(async (_uid: string, fn: (db: unknown) => unknown) =>
      fn({
        select: vi
          .fn()
          .mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ accountKind: 'production' }]),
              }),
            }),
          }),
      }),
    )
    enqueueUserJobMock.mockResolvedValue({ enqueued: true, jobId: 'job-1' })

    const result = await maybeEnqueueErpNextInvoicePush({
      userId: 'u1',
      paymentOrderId: 'order-1',
      payerEmail: 'payer@example.com',
    })

    expect(result).toEqual({ enqueued: true })
    expect(enqueueUserJobMock).toHaveBeenCalledWith({
      userId: 'u1',
      jobType: 'erpnext_invoice_push',
      runAfter: expect.any(Date),
      dedupeKey: `${ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX}order-1`,
      payload: { paymentOrderId: 'order-1' },
      maxAttempts: 3,
    })
  })

  it('passes through the duplicate result when a job is already pending', async () => {
    stubErpNextEnv()
    withDbUserMock.mockImplementation(async (_uid: string, fn: (db: unknown) => unknown) =>
      fn({
        select: vi
          .fn()
          .mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ accountKind: 'production' }]),
              }),
            }),
          }),
      }),
    )
    enqueueUserJobMock.mockResolvedValue({ enqueued: false, reason: 'duplicate' })

    const result = await maybeEnqueueErpNextInvoicePush({
      userId: 'u1',
      paymentOrderId: 'order-1',
      payerEmail: 'payer@example.com',
    })

    expect(result).toEqual({ enqueued: false, reason: 'duplicate' })
  })
})

describe('processErpNextInvoicePushJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEnv()
    fetchMock.mockReset()
    withDbUserMock.mockImplementation(async (_uid: string, fn: (db: unknown) => unknown) =>
      fn(getDbMock()),
    )
  })

  it('throws when the payload is missing the payment order id', async () => {
    await expect(
      processErpNextInvoicePushJob(jobFixture({ payload: {} })),
    ).rejects.toThrow(/paymentOrderId/)
  })

  it('throws explicitly when ERPNext is not configured', async () => {
    buildSelectDb([orderFixture()])
    await expect(processErpNextInvoicePushJob(jobFixture())).rejects.toThrow(/ERPNEXT_/)
  })

  it('throws when the payment order is not found', async () => {
    stubErpNextEnv()
    buildSelectDb([])
    await expect(processErpNextInvoicePushJob(jobFixture())).rejects.toThrow(/not found/)
  })

  it('throws when the order belongs to another user', async () => {
    stubErpNextEnv()
    buildSelectDb([orderFixture({ userId: 'someone-else' })])
    await expect(processErpNextInvoicePushJob(jobFixture())).rejects.toThrow(/not found/)
  })

  it('skips without HTTP calls when the invoice was already pushed', async () => {
    stubErpNextEnv()
    buildSelectDb([orderFixture({ erpNextInvoiceName: 'SINV-0001' })])

    const result = await processErpNextInvoicePushJob(jobFixture())

    expect(result).toEqual({ skipped: true, invoiceName: 'SINV-0001' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when the order is not captured', async () => {
    stubErpNextEnv()
    buildSelectDb([orderFixture({ status: 'created' })])
    await expect(processErpNextInvoicePushJob(jobFixture())).rejects.toThrow(/captured/)
  })

  it('throws when the captured order has no payer email', async () => {
    stubErpNextEnv()
    buildSelectDb([orderFixture({ payerEmail: null })])
    await expect(processErpNextInvoicePushJob(jobFixture())).rejects.toThrow(/payer/)
  })

  it('pushes the invoice and persists the ERPNext name and sync time', async () => {
    stubErpNextEnv()
    const { updateSet } = buildSelectDb([orderFixture()])
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { exc_type: 'DoesNotExistError' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { name: 'payer@example.com' } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { name: 'SINV-0007' } }))

    const result = await processErpNextInvoicePushJob(jobFixture())

    expect(result).toEqual({ skipped: false, invoiceName: 'SINV-0007' })
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        erpNextInvoiceName: 'SINV-0007',
        erpNextSyncedAt: expect.any(Date),
      }),
    )
  })
})

describe('enqueueErpNextInvoiceBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEnv()
    createAdminSqlMock.mockReset()
    sqlEndMock.mockReset()
  })

  it('reports disabled without querying when ERPNext is not configured', async () => {
    const result = await enqueueErpNextInvoiceBackfill()

    expect(result).toEqual({ matched: 0, enqueued: 0, duplicates: 0, disabled: true })
    expect(createAdminSqlMock).not.toHaveBeenCalled()
  })

  it('enqueues one job per uninvoiced captured production payment', async () => {
    stubErpNextEnv()
    const rows = [
      { id: 'order-1', user_id: 'u1' },
      { id: 'order-2', user_id: 'u2' },
    ]
    const sqlTag = vi.fn().mockResolvedValue(rows)
    const sqlFake = Object.assign(sqlTag, { end: sqlEndMock })
    createAdminSqlMock.mockReturnValue(sqlFake)
    enqueueUserJobMock
      .mockResolvedValueOnce({ enqueued: true, jobId: 'job-1' })
      .mockResolvedValueOnce({ enqueued: false, reason: 'duplicate' })

    const result = await enqueueErpNextInvoiceBackfill()

    expect(result).toEqual({ matched: 2, enqueued: 1, duplicates: 1, disabled: false })
    expect(enqueueUserJobMock).toHaveBeenCalledTimes(2)
    expect(enqueueUserJobMock.mock.calls[0]?.[0]).toMatchObject({
      userId: 'u1',
      jobType: 'erpnext_invoice_push',
      dedupeKey: `${ERPNEXT_INVOICE_PUSH_DEDUPE_PREFIX}order-1`,
      maxAttempts: 3,
    })
    expect(sqlEndMock).toHaveBeenCalled()
  })
})

describe('loadErpNextSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEnv()
    createAdminSqlMock.mockReset()
    sqlEndMock.mockReset()
  })

  it('reports configured=false and zero counts without querying when disabled', async () => {
    const result = await loadErpNextSyncStatus()

    expect(result).toEqual({
      configured: false,
      uninvoicedCount: 0,
      invoicedCount: 0,
      failedJobCount: 0,
    })
    expect(createAdminSqlMock).not.toHaveBeenCalled()
  })

  it('aggregates uninvoiced, invoiced, and failed-job counts', async () => {
    stubErpNextEnv()
    const sqlTag = vi
      .fn()
      .mockResolvedValueOnce([
        { uninvoiced: 3, invoiced: 5 },
      ])
      .mockResolvedValueOnce([{ failed: 1 }])
    const sqlFake = Object.assign(sqlTag, { end: sqlEndMock })
    createAdminSqlMock.mockReturnValue(sqlFake)

    const result = await loadErpNextSyncStatus()

    expect(result).toEqual({
      configured: true,
      uninvoicedCount: 3,
      invoicedCount: 5,
      failedJobCount: 1,
    })
    expect(sqlEndMock).toHaveBeenCalled()
  })
})
