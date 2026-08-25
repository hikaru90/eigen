import { env } from '$lib/server/env/private-env'
import { computeTopUpCheckout } from '$lib/server/billing/checkout-pricing'

const PAYPAL_SETTLEMENT_CURRENCY = 'USD'

type PayPalAccessToken = { access_token: string; expires_in: number }

type PayPalMoney = { currency_code?: string; value?: string }

type PayPalSellerBreakdown = {
  gross_amount?: PayPalMoney
  paypal_fee?: PayPalMoney
  net_amount?: PayPalMoney
}

type PayPalCaptureObject = {
  id?: string
  status?: string
  amount?: PayPalMoney
  seller_receivable_breakdown?: PayPalSellerBreakdown
}

let cachedToken: { token: string; expiresAt: number } | null = null

export function getPayPalApiBase(): string {
  const base = (env.PAYPAL_API_BASE ?? env.PAYPAL_URL)?.trim()
  if (!base) {
    throw new Error('PayPal base URL is required (set PAYPAL_API_BASE or PAYPAL_URL)')
  }
  const normalized = base.replace(/\/$/, '')
  const lower = normalized.toLowerCase()
  if (
    (lower.includes('sandbox.paypal.com') || lower.includes('www.paypal.com')) &&
    !lower.includes('api-m.')
  ) {
    throw new Error(
      'PAYPAL_API_BASE must be the PayPal REST host (sandbox: https://api-m.sandbox.paypal.com, live: https://api-m.paypal.com), not the marketing site https://sandbox.paypal.com',
    )
  }
  return normalized
}

export function getPayPalClientId(): string {
  const id = env.PAYPAL_CLIENT_ID?.trim()
  if (!id) {
    throw new Error('PAYPAL_CLIENT_ID is required')
  }
  return id
}

export function getPayPalClientSecret(): string {
  const secret = (env.PAYPAL_CLIENT_SECRET ?? env.PAYPAL_SECRET)?.trim()
  if (!secret) {
    throw new Error('PayPal client secret is required (set PAYPAL_CLIENT_SECRET or PAYPAL_SECRET)')
  }
  return secret
}

/** True when PayPal REST + SDK credentials are all present (safe to show checkout UI). */
export function isPayPalConfigured(): boolean {
  try {
    getPayPalClientId()
    getPayPalWebSdkUrl()
    getPayPalClientSecret()
    return true
  } catch {
    return false
  }
}

const PAYPAL_SDK_V6_LIVE = 'https://www.paypal.com/web-sdk/v6/core'
const PAYPAL_SDK_V6_SANDBOX = 'https://www.sandbox.paypal.com/web-sdk/v6/core'

export function getPayPalWebSdkUrl(): string {
  const override = env.PAYPAL_WEB_SDK_URL?.trim()
  if (override) {
    return override.replace(/\/$/, '')
  }

  const truthy = (v: string | undefined) => v === '1' || v?.toLowerCase() === 'true'
  if (truthy(env.PAYPAL_USE_SANDBOX_SDK)) {
    return PAYPAL_SDK_V6_SANDBOX
  }
  if (truthy(env.PAYPAL_USE_LIVE_SDK)) {
    return PAYPAL_SDK_V6_LIVE
  }

  const base = getPayPalApiBase().toLowerCase()
  const looksSandbox =
    base.includes('sandbox') || base.includes('api-m.sandbox') || base.includes('sandbox.paypal')
  return looksSandbox ? PAYPAL_SDK_V6_SANDBOX : PAYPAL_SDK_V6_LIVE
}

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token
  }

  const base = getPayPalApiBase()
  const credentials = Buffer.from(`${getPayPalClientId()}:${getPayPalClientSecret()}`).toString(
    'base64',
  )
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`PayPal OAuth failed HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = JSON.parse(text) as PayPalAccessToken
  if (!json.access_token) {
    throw new Error('PayPal OAuth response missing access_token')
  }
  cachedToken = {
    token: json.access_token,
    expiresAt: now + (json.expires_in ?? 300) * 1000,
  }
  return json.access_token
}

async function paypalFetch(path: string, init: RequestInit): Promise<unknown> {
  const token = await getAccessToken()
  const res = await fetch(`${getPayPalApiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    json = { raw: text }
  }
  if (!res.ok) {
    throw new Error(`PayPal API ${path} HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  return json
}

export type PayPalCreateOrderResult = {
  id: string
  status: string
  grossPayPalValue: string
}

export async function createPayPalOrder(input: {
  amountCredits: number
}): Promise<PayPalCreateOrderResult> {
  const quote = computeTopUpCheckout(input.amountCredits)
  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        amount: {
          currency_code: PAYPAL_SETTLEMENT_CURRENCY,
          value: quote.paypalAmount,
        },
      },
    ],
  }
  const json = (await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as { id?: string; status?: string }
  if (!json.id) {
    throw new Error('PayPal create order response missing id')
  }
  return {
    id: json.id,
    status: json.status ?? 'CREATED',
    grossPayPalValue: quote.paypalAmount,
  }
}

function parsePayPalUsdValue(money: PayPalMoney | undefined, label: string): string {
  const value = money?.value?.trim()
  if (!value) {
    throw new Error(`PayPal capture missing ${label}`)
  }
  const currency = money?.currency_code?.trim() ?? PAYPAL_SETTLEMENT_CURRENCY
  if (currency !== PAYPAL_SETTLEMENT_CURRENCY) {
    throw new Error(
      `PayPal ${label} currency must be ${PAYPAL_SETTLEMENT_CURRENCY}, got ${currency}`,
    )
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`PayPal ${label} is invalid: ${value}`)
  }
  return parsed.toFixed(2)
}

function extractCaptureFromOrder(json: Record<string, unknown>): PayPalCaptureObject | null {
  const purchaseUnits = json.purchase_units
  const unit = Array.isArray(purchaseUnits) ? purchaseUnits[0] : null
  const captures =
    unit && typeof unit === 'object'
      ? (unit as { payments?: { captures?: unknown[] } }).payments?.captures
      : undefined
  const capture =
    Array.isArray(captures) && captures[0] && typeof captures[0] === 'object' ? captures[0] : null
  return capture as PayPalCaptureObject | null
}

async function resolveCaptureWithBreakdown(
  capture: PayPalCaptureObject,
): Promise<PayPalCaptureObject> {
  if (capture.seller_receivable_breakdown?.net_amount?.value) {
    return capture
  }
  const captureId = capture.id?.trim()
  if (!captureId) {
    throw new Error('PayPal capture missing id for fee breakdown lookup')
  }
  const detail = (await paypalFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}`, {
    method: 'GET',
  })) as PayPalCaptureObject
  if (!detail.seller_receivable_breakdown?.net_amount?.value) {
    throw new Error(
      'PayPal capture fee breakdown unavailable (payment may still be pending). Retry capture shortly.',
    )
  }
  return detail
}

export type PayPalCaptureResult = {
  id: string
  status: string
  payerEmail: string | null
  grossUsd: string
  paypalFeeUsd: string
  netUsd: string
  currency: string
  raw: Record<string, unknown>
}

export async function capturePayPalOrder(orderId: string): Promise<PayPalCaptureResult> {
  const json = (await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
  })) as Record<string, unknown>

  const status = typeof json.status === 'string' ? json.status : ''
  let capture = extractCaptureFromOrder(json)
  if (!capture) {
    throw new Error('PayPal capture response missing capture object')
  }

  capture = await resolveCaptureWithBreakdown(capture)

  const grossUsd = parsePayPalUsdValue(capture.amount, 'gross amount')
  const breakdown = capture.seller_receivable_breakdown
  const paypalFeeUsd = parsePayPalUsdValue(breakdown?.paypal_fee, 'paypal_fee')
  const netUsd = parsePayPalUsdValue(breakdown?.net_amount, 'net_amount')

  const payer = json.payer
  const payerEmail =
    payer &&
    typeof payer === 'object' &&
    typeof (payer as { email_address?: string }).email_address === 'string'
      ? (payer as { email_address: string }).email_address
      : null

  return {
    id: typeof json.id === 'string' ? json.id : orderId,
    status,
    payerEmail,
    grossUsd,
    paypalFeeUsd,
    netUsd,
    currency: PAYPAL_SETTLEMENT_CURRENCY,
    raw: json,
  }
}

/** Infer checkout currency from PayPal order details (before capture). */
export async function getPayPalOrderCurrency(orderId: string): Promise<string | null> {
  const json = (await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
  })) as {
    purchase_units?: Array<{ amount?: { currency_code?: string } }>
  }
  const code = json.purchase_units?.[0]?.amount?.currency_code
  return code?.trim() ? code.trim().toUpperCase() : null
}

/** @internal Exported for unit tests. */
export function parsePayPalCaptureBreakdownForTest(capture: PayPalCaptureObject): {
  grossUsd: string
  paypalFeeUsd: string
  netUsd: string
} {
  const grossUsd = parsePayPalUsdValue(capture.amount, 'gross amount')
  const breakdown = capture.seller_receivable_breakdown
  return {
    grossUsd,
    paypalFeeUsd: parsePayPalUsdValue(breakdown?.paypal_fee, 'paypal_fee'),
    netUsd: parsePayPalUsdValue(breakdown?.net_amount, 'net_amount'),
  }
}
