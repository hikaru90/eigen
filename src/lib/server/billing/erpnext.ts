import { env } from '$lib/server/env/private-env'

const ERPNEXT_CURRENCY = 'USD'

export type ErpNextConfig = {
  /** Normalized base URL without trailing slash (e.g. https://erp.example.com). */
  baseUrl: string
  apiKey: string
  apiSecret: string
  company: string
  itemCode: string
  taxesTemplate: string | null
}

function readEnv(key: keyof typeof env): string {
  const value = (env[key] as string | undefined)?.trim() ?? ''
  return value
}

/**
 * ERPNext invoice sync configuration.
 *
 * - All required vars unset → `null` (feature disabled, like PayPal when unconfigured).
 * - Any required var set but some missing → throws (no implicit defaults).
 */
export function loadErpNextConfig(): ErpNextConfig | null {
  const baseUrl = readEnv('ERPNEXT_BASE_URL')
  const apiKey = readEnv('ERPNEXT_API_KEY')
  const apiSecret = readEnv('ERPNEXT_API_SECRET')
  const company = readEnv('ERPNEXT_COMPANY')
  const itemCode = readEnv('ERPNEXT_ITEM_CODE')
  const taxesTemplate = readEnv('ERPNEXT_TAXES_TEMPLATE')

  const required = { ERPNEXT_BASE_URL: baseUrl, ERPNEXT_API_KEY: apiKey, ERPNEXT_API_SECRET: apiSecret, ERPNEXT_COMPANY: company, ERPNEXT_ITEM_CODE: itemCode }
  const values = Object.values(required)
  if (values.every((v) => v === '')) {
    return null
  }

  const missing = Object.entries(required)
    .filter(([, v]) => v === '')
    .map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(
      `ERPNext invoice sync is partially configured; missing env vars: ${missing.join(', ')}. Set all ERPNEXT_* vars or none.`,
    )
  }

  const normalizedBase = baseUrl.replace(/\/$/, '')
  if (!/^https?:\/\//.test(normalizedBase)) {
    throw new Error(
      'ERPNEXT_BASE_URL must start with http:// or https:// (e.g. https://erp.example.com)',
    )
  }

  return {
    baseUrl: normalizedBase,
    apiKey,
    apiSecret,
    company,
    itemCode,
    taxesTemplate: taxesTemplate || null,
  }
}

type SalesInvoiceItemRow = {
  item_code: string
  qty: number
  rate: string
  description: string
}

export type SalesInvoicePayload = {
  doctype: 'Sales Invoice'
  company: string
  customer: string
  posting_date: string
  currency: string
  set_posting_time: number
  docstatus: number
  items: SalesInvoiceItemRow[]
  remarks: string
  taxes_and_charges?: string
}

export type ErpNextPaymentOrder = {
  paypalOrderId: string
  requestedCredits: number
  chargedGrossUsd: string | null
  currency: string
  payerEmail: string | null
  updatedAt: Date | null
  createdAt: Date
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** Pure Sales Invoice payload builder (German invoice content per § 14 UStG: Vorauszahlung + Vereinnahmungsdatum). */
export function buildSalesInvoicePayload(input: {
  config: ErpNextConfig
  customer: string
  order: ErpNextPaymentOrder
}): SalesInvoicePayload {
  const { config, customer, order } = input

  if (!customer) {
    throw new Error('ERPNext invoice requires a customer name')
  }
  if (order.currency !== ERPNEXT_CURRENCY) {
    throw new Error(
      `ERPNext invoice currency must be ${ERPNEXT_CURRENCY}, got ${order.currency}`,
    )
  }
  const gross = Number(order.chargedGrossUsd)
  if (!order.chargedGrossUsd || !Number.isFinite(gross) || gross <= 0) {
    throw new Error(
      'ERPNext invoice requires chargedGrossUsd from checkout pricing (legacy orders cannot be invoiced)',
    )
  }
  if (!Number.isInteger(order.requestedCredits) || order.requestedCredits < 1) {
    throw new Error(`Invalid requestedCredits on payment order: ${order.requestedCredits}`)
  }

  const postingDate = toIsoDate(order.updatedAt ?? order.createdAt)
  const credits = order.requestedCredits.toLocaleString('en-US')
  const description = `Vorauszahlung Eigen-Credits (${credits} Credits, digitale Dienstleistung), vereinnahmt am ${postingDate}, PayPal-Order ${order.paypalOrderId}`

  const payload: SalesInvoicePayload = {
    doctype: 'Sales Invoice',
    company: config.company,
    customer,
    posting_date: postingDate,
    currency: ERPNEXT_CURRENCY,
    set_posting_time: 1,
    docstatus: 0,
    items: [
      {
        item_code: config.itemCode,
        qty: 1,
        rate: gross.toFixed(2),
        description,
      },
    ],
    remarks: description,
  }
  if (config.taxesTemplate) {
    payload.taxes_and_charges = config.taxesTemplate
  }
  return payload
}

async function erpNextFetch(
  config: ErpNextConfig,
  path: string,
  init: RequestInit,
): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `token ${config.apiKey}:${config.apiSecret}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json, text }
}

function erpNextError(path: string, status: number, text: string): Error {
  return new Error(`ERPNext API ${path} HTTP ${status}: ${text.slice(0, 500)}`)
}

/** Look up the customer by payer email (name = email) and create it when missing. Returns the ERPNext customer name. */
export async function ensureErpNextCustomer(
  config: ErpNextConfig,
  email: string,
): Promise<string> {
  const encoded = encodeURIComponent(email)
  const existing = await erpNextFetch(
    config,
    `/api/resource/Customer/${encoded}`,
    { method: 'GET' },
  )
  if (existing.status === 200) {
    const data = existing.json.data as { name?: unknown } | undefined
    const name = typeof data?.name === 'string' ? data.name : ''
    if (name) {
      return name
    }
    throw new Error(`ERPNext customer response missing name for ${email}`)
  }
  if (existing.status !== 404) {
    throw erpNextError(`Customer/${encoded}`, existing.status, existing.text)
  }

  const created = await erpNextFetch(config, '/api/resource/Customer', {
    method: 'POST',
    body: JSON.stringify({
      doctype: 'Customer',
      customer_name: email,
      customer_type: 'Individual',
    }),
  })
  if (created.status < 200 || created.status >= 300) {
    throw erpNextError('Customer', created.status, created.text)
  }
  const data = created.json.data as { name?: unknown } | undefined
  const name = typeof data?.name === 'string' ? data.name : ''
  if (!name) {
    throw new Error(`ERPNext customer creation response missing name for ${email}`)
  }
  return name
}

/** Create a draft Sales Invoice and return the ERPNext document name. */
export async function createErpNextSalesInvoice(
  config: ErpNextConfig,
  payload: SalesInvoicePayload,
): Promise<string> {
  const res = await erpNextFetch(config, '/api/resource/Sales%20Invoice', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (res.status < 200 || res.status >= 300) {
    throw erpNextError('Sales Invoice', res.status, res.text)
  }
  const data = res.json.data as { name?: unknown } | undefined
  const name = typeof data?.name === 'string' ? data.name : ''
  if (!name) {
    throw new Error('ERPNext Sales Invoice response missing name')
  }
  return name
}

export type ErpNextPushResult = {
  customerName: string
  invoiceName: string
}

/** Ensure customer + create draft invoice for one captured payment order. */
export async function pushErpNextInvoice(
  config: ErpNextConfig,
  order: ErpNextPaymentOrder,
): Promise<ErpNextPushResult> {
  if (!order.payerEmail) {
    throw new Error('ERPNext invoice requires the PayPal payer email')
  }
  const customerName = await ensureErpNextCustomer(config, order.payerEmail)
  const payload = buildSalesInvoicePayload({ config, customer: customerName, order })
  const invoiceName = await createErpNextSalesInvoice(config, payload)
  return { customerName, invoiceName }
}
