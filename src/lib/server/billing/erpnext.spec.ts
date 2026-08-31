import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, fetchMock } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  fetchMock: vi.fn(),
}))

vi.mock('$lib/server/env/private-env', () => ({
  env: mockEnv,
}))

vi.stubGlobal('fetch', fetchMock)

import {
  buildSalesInvoicePayload,
  createErpNextSalesInvoice,
  ensureErpNextCustomer,
  loadErpNextConfig,
  pushErpNextInvoice,
  type ErpNextConfig,
} from './erpnext'

function clearEnv() {
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key]
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const BASE_CONFIG: ErpNextConfig = {
  baseUrl: 'https://accounting.coolify.stackstack.de',
  apiKey: 'key-123',
  apiSecret: 'secret-456',
  company: 'Buck',
  itemCode: 'EIGEN-CREDITS',
  taxesTemplate: null,
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
    ...overrides,
  }
}

describe('loadErpNextConfig', () => {
  beforeEach(() => {
    clearEnv()
  })

  it('returns null (disabled) when all ERPNext vars are unset', () => {
    expect(loadErpNextConfig()).toBeNull()
  })

  it('returns null (disabled) when all ERPNext vars are empty strings', () => {
    mockEnv.ERPNEXT_BASE_URL = ''
    mockEnv.ERPNEXT_API_KEY = ''
    mockEnv.ERPNEXT_API_SECRET = ''
    mockEnv.ERPNEXT_COMPANY = ''
    mockEnv.ERPNEXT_ITEM_CODE = ''
    expect(loadErpNextConfig()).toBeNull()
  })

  it('returns normalized config when all required vars are set', () => {
    mockEnv.ERPNEXT_BASE_URL = 'https://erp.example.com/'
    mockEnv.ERPNEXT_API_KEY = 'key-123'
    mockEnv.ERPNEXT_API_SECRET = 'secret-456'
    mockEnv.ERPNEXT_COMPANY = 'Buck'
    mockEnv.ERPNEXT_ITEM_CODE = 'EIGEN-CREDITS'

    expect(loadErpNextConfig()).toEqual({
      baseUrl: 'https://erp.example.com',
      apiKey: 'key-123',
      apiSecret: 'secret-456',
      company: 'Buck',
      itemCode: 'EIGEN-CREDITS',
      taxesTemplate: null,
    })
  })

  it('passes through the optional taxes template', () => {
    mockEnv.ERPNEXT_BASE_URL = 'https://erp.example.com'
    mockEnv.ERPNEXT_API_KEY = 'key-123'
    mockEnv.ERPNEXT_API_SECRET = 'secret-456'
    mockEnv.ERPNEXT_COMPANY = 'Buck'
    mockEnv.ERPNEXT_ITEM_CODE = 'EIGEN-CREDITS'
    mockEnv.ERPNEXT_TAXES_TEMPLATE = 'Kleinunternehmer § 19 UStG'

    expect(loadErpNextConfig()?.taxesTemplate).toBe('Kleinunternehmer § 19 UStG')
  })

  it('throws an explicit error when only some vars are set', () => {
    mockEnv.ERPNEXT_BASE_URL = 'https://erp.example.com'
    mockEnv.ERPNEXT_API_KEY = 'key-123'

    expect(() => loadErpNextConfig()).toThrow(/ERPNEXT_API_SECRET/)
  })

  it('rejects a base URL without http(s)', () => {
    mockEnv.ERPNEXT_BASE_URL = 'erp.example.com'
    mockEnv.ERPNEXT_API_KEY = 'key-123'
    mockEnv.ERPNEXT_API_SECRET = 'secret-456'
    mockEnv.ERPNEXT_COMPANY = 'Buck'
    mockEnv.ERPNEXT_ITEM_CODE = 'EIGEN-CREDITS'

    expect(() => loadErpNextConfig()).toThrow(/ERPNEXT_BASE_URL/)
  })
})

describe('buildSalesInvoicePayload', () => {
  it('builds a draft Sales Invoice with the Vereinnahmung date and PayPal reference', () => {
    const payload = buildSalesInvoicePayload({
      config: BASE_CONFIG,
      customer: 'payer@example.com',
      order: orderFixture(),
    })

    expect(payload.doctype).toBe('Sales Invoice')
    expect(payload.company).toBe('Buck')
    expect(payload.customer).toBe('payer@example.com')
    expect(payload.posting_date).toBe('2026-08-31')
    expect(payload.currency).toBe('USD')
    expect(payload.set_posting_time).toBe(1)
    expect(payload.docstatus).toBe(0)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      item_code: 'EIGEN-CREDITS',
      qty: 1,
      rate: '1.75',
    })
    expect(payload.items[0].description).toContain('1,000 Credits')
    expect(payload.items[0].description).toContain('Vorauszahlung')
    expect(payload.items[0].description).toContain('2026-08-31')
    expect(payload.items[0].description).toContain('PP-ORDER-1')
    expect(payload.remarks).toContain('PP-ORDER-1')
  })

  it('includes the taxes template when configured', () => {
    const payload = buildSalesInvoicePayload({
      config: { ...BASE_CONFIG, taxesTemplate: 'Kleinunternehmer § 19 UStG' },
      customer: 'payer@example.com',
      order: orderFixture(),
    })
    expect(payload.taxes_and_charges).toBe('Kleinunternehmer § 19 UStG')
  })

  it('omits taxes_and_charges when no template is configured', () => {
    const payload = buildSalesInvoicePayload({
      config: BASE_CONFIG,
      customer: 'payer@example.com',
      order: orderFixture(),
    })
    expect('taxes_and_charges' in payload).toBe(false)
  })

  it('throws when the payment currency is not USD', () => {
    expect(() =>
      buildSalesInvoicePayload({
        config: BASE_CONFIG,
        customer: 'payer@example.com',
        order: orderFixture({ currency: 'EUR' }),
      }),
    ).toThrow(/USD/)
  })

  it('throws when checkout pricing is missing (legacy order)', () => {
    expect(() =>
      buildSalesInvoicePayload({
        config: BASE_CONFIG,
        customer: 'payer@example.com',
        order: orderFixture({ chargedGrossUsd: null }),
      }),
    ).toThrow(/chargedGrossUsd/)
  })

  it('throws when the gross amount is not a positive decimal', () => {
    expect(() =>
      buildSalesInvoicePayload({
        config: BASE_CONFIG,
        customer: 'payer@example.com',
        order: orderFixture({ chargedGrossUsd: '-1.00' }),
      }),
    ).toThrow(/chargedGrossUsd/)
  })
})

describe('ensureErpNextCustomer', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('returns the existing customer name without creating', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { data: { name: 'payer@example.com' } }),
    )

    const name = await ensureErpNextCustomer(BASE_CONFIG, 'payer@example.com')

    expect(name).toBe('payer@example.com')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://accounting.coolify.stackstack.de/api/resource/Customer/payer%40example.com',
    )
  })

  it('creates the customer when ERPNext returns 404', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { exc_type: 'DoesNotExistError' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { name: 'payer@example.com' } }))

    const name = await ensureErpNextCustomer(BASE_CONFIG, 'payer@example.com')

    expect(name).toBe('payer@example.com')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://accounting.coolify.stackstack.de/api/resource/Customer')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({
      doctype: 'Customer',
      customer_name: 'payer@example.com',
      customer_type: 'Individual',
    })
  })

  it('sends token auth and never leaks the secret in thrown errors', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(500, 'internal error'),
    )

    await expect(ensureErpNextCustomer(BASE_CONFIG, 'payer@example.com')).rejects.toThrow(
      /HTTP 500/,
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('token key-123:secret-456')
    await expect(
      ensureErpNextCustomer(BASE_CONFIG, 'payer@example.com').catch((e) => {
        throw new Error(String(e))
      }),
    ).rejects.not.toThrow(/secret-456/)
  })
})

describe('createErpNextSalesInvoice', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('POSTs the payload and returns the invoice name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { name: 'SINV-0001' } }))

    const name = await createErpNextSalesInvoice(BASE_CONFIG, {
      doctype: 'Sales Invoice',
      company: 'Buck',
      customer: 'payer@example.com',
    })

    expect(name).toBe('SINV-0001')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://accounting.coolify.stackstack.de/api/resource/Sales%20Invoice',
    )
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'token key-123:secret-456',
    )
    expect(JSON.parse(String(init.body))).toMatchObject({ company: 'Buck' })
  })

  it('throws explicitly when the response has no invoice name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: {} }))
    await expect(createErpNextSalesInvoice(BASE_CONFIG, { doctype: 'Sales Invoice' })).rejects.toThrow(
      /name/,
    )
  })

  it('surfaces ERPNext validation errors without leaking the token', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(417, { exception: 'frappe.exceptions.ValidationError', _server_messages: '[]' }),
    )
    await expect(
      createErpNextSalesInvoice(BASE_CONFIG, { doctype: 'Sales Invoice' }),
    ).rejects.toThrow(/HTTP 417/)
    const errorText = await createErpNextSalesInvoice(
      BASE_CONFIG,
      { doctype: 'Sales Invoice' },
    ).catch((e) => String(e))
    expect(errorText).not.toContain('secret-456')
  })
})

describe('pushErpNextInvoice', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('ensures the customer, creates the draft invoice, and returns both names', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(404, { exc_type: 'DoesNotExistError' }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { name: 'payer@example.com' } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { name: 'SINV-0007' } }))

    const result = await pushErpNextInvoice(BASE_CONFIG, orderFixture())

    expect(result).toEqual({
      customerName: 'payer@example.com',
      invoiceName: 'SINV-0007',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const [, invoiceInit] = fetchMock.mock.calls[2] as [string, RequestInit]
    const body = JSON.parse(String(invoiceInit.body))
    expect(body.customer).toBe('payer@example.com')
    expect(body.items[0].rate).toBe('1.75')
  })
})
