/** PayPal JS SDK v6 integration (docs: https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration) */

import { capture } from '$lib/analytics/posthog-client'
import { MIN_TOP_UP_CREDITS } from '$lib/billing/platform-pricing'
import { randomUuid } from '$lib/random-uuid'

type PayPalPaymentSession = {
  start: (
    options: { presentationMode: string },
    /** v6 expects a Promise (e.g. `createOrder()`), not a callback — see PayPal JS SDK v6 docs */
    createOrder: Promise<{ orderId: string }>,
  ) => Promise<void>
}

type PayPalSdkInstance = {
  findEligibleMethods: (input: { currencyCode: string }) => Promise<{
    isEligible: (method: string) => boolean
    getDetails?: (method: string) => unknown
  }>
  createPayPalOneTimePaymentSession: (options: {
    onApprove: (data: { orderId: string }) => Promise<void>
    onCancel?: (data: unknown) => void
    onError?: (error: unknown) => void
  }) => PayPalPaymentSession
}

declare global {
  interface Window {
    paypal?: {
      createInstance: (options: {
        clientId: string
        components?: string[]
        pageType?: string
        locale?: string
        clientMetadataId?: string
        merchantId?: string
      }) => Promise<PayPalSdkInstance>
    }
  }
}

/** Ensures concurrent callers await the same load + API availability. */
const loadOnceBySdkUrl = new Map<string, Promise<void>>()

function normalizeSdkUrlHint(url: string): string {
  try {
    const u = new URL(url.trim())
    return `${u.origin}${u.pathname}`
  } catch {
    return url.trim().replace(/\/?$/, '')
  }
}

function isV6CoreScriptUrl(candidate: URL, desiredOrigin: string): boolean {
  if (candidate.origin !== desiredOrigin) return false
  return /\/web-sdk\/v6\/core\/?$/i.test(candidate.pathname)
}

function findExistingV6CoreScript(desiredNormalized: string): HTMLScriptElement | null {
  let desiredOrigin: string
  try {
    desiredOrigin = new URL(desiredNormalized).origin
  } catch {
    return null
  }
  for (const s of Array.from(document.querySelectorAll('script[src]'))) {
    const raw = (s as HTMLScriptElement).src?.trim()
    if (!raw) continue
    try {
      const u = new URL(raw)
      if (isV6CoreScriptUrl(u, desiredOrigin)) return s as HTMLScriptElement
    } catch {
      continue
    }
  }
  return null
}

/**
 * Wait for v6 bootstrap: core script fires `load` before `window.paypal.createInstance`
 * exists (bundles hydrate asynchronously — see paypal-examples v6 repo).
 */
function waitForCreateInstance(timeoutMs = 20_000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    function tick() {
      const fn = typeof window !== 'undefined' ? window.paypal?.createInstance : undefined
      if (typeof fn === 'function') {
        resolve()
        return
      }
      if (Date.now() >= deadline) {
        reject(
          new Error(
            'PayPal SDK script ran but `window.paypal.createInstance` did not appear. Check sandbox vs live: PAYPAL_WEB_SDK_URL must match your PAYPAL_CLIENT_ID environment (sandbox script + sandbox REST base). See https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration',
          ),
        )
        return
      }
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

export async function loadPayPalSdkScript(sdkUrl: string): Promise<void> {
  const normalized = normalizeSdkUrlHint(sdkUrl)
  let job = loadOnceBySdkUrl.get(normalized)
  if (!job) {
    job = (async () => {
      const existing = findExistingV6CoreScript(normalized)

      if (!existing) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = normalized
          script.async = true
          script.crossOrigin = 'anonymous'
          script.onload = () => resolve()
          script.onerror = () => reject(new Error(`Failed to load PayPal SDK from ${normalized}`))
          document.head.appendChild(script)
        })
      }

      await waitForCreateInstance()
    })()

    loadOnceBySdkUrl.set(normalized, job)

    job.catch(() => {
      loadOnceBySdkUrl.delete(normalized)
    })
  }

  await job
}

const PAYPAL_CHECKOUT_CURRENCY = 'USD'

export async function initPayPalCheckout(input: {
  clientId: string
  sdkUrl: string
  getAmountCredits: () => number
  onBalanceUpdated: () => void
  onStatus: (message: string) => void
  onError: (message: string) => void
  button: HTMLElement
}): Promise<() => void> {
  await loadPayPalSdkScript(input.sdkUrl)

  const paypal = window.paypal
  if (!paypal?.createInstance) {
    throw new Error('PayPal SDK is not initialized')
  }

  let clientMetadataId: string | undefined
  try {
    clientMetadataId = randomUuid()
  } catch {
    clientMetadataId = undefined
  }

  const sdkInstance = await paypal.createInstance({
    clientId: input.clientId,
    components: ['paypal-payments'],
    pageType: 'checkout',
    ...(clientMetadataId !== undefined ? { clientMetadataId } : {}),
  })

  const methods = await sdkInstance.findEligibleMethods({ currencyCode: PAYPAL_CHECKOUT_CURRENCY })
  if (!methods.isEligible('paypal')) {
    throw new Error(
      'PayPal checkout is not available in this browser (eligibility declined). Ensure sandbox Client ID + https://www.sandbox.paypal.com/web-sdk/v6/core with REST base api-m.sandbox.paypal.com — or override PAYPAL_WEB_SDK_URL. Docs: https://docs.paypal.ai/developer/how-to/sdk/js/v6/configuration',
    )
  }

  const session = sdkInstance.createPayPalOneTimePaymentSession({
    async onApprove(data) {
      capture('billing_paypal_approved', { order_id: data.orderId })
      input.onStatus('Capturing payment…')
      const amountCredits = input.getAmountCredits()
      try {
        const res = await fetch('/api/billing/paypal/capture-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orderId }),
        })
        const body = await res.json().catch(() => null)
        if (!res.ok) {
          throw new Error(
            typeof body?.error === 'string' ? body.error : `Capture failed (${res.status})`,
          )
        }
        if (typeof body?.availableCredits === 'number') {
          input.onBalanceUpdated()
        }
        capture('billing_checkout_completed', {
          order_id: data.orderId,
          amount_credits: amountCredits,
          credited: body?.credited === true,
          already_captured: body?.alreadyCaptured === true,
          available_credits: body?.availableCredits,
        })
        input.onStatus('Credits added to your account.')
      } catch (e) {
        capture('billing_checkout_capture_failed', {
          order_id: data.orderId,
          amount_credits: amountCredits,
          error_message: e instanceof Error ? e.message : String(e),
        })
        throw e
      }
    },
    onCancel() {
      capture('billing_paypal_cancelled')
      input.onStatus('Payment cancelled.')
    },
    onError(err) {
      const message = err instanceof Error ? err.message : 'Payment failed'
      capture('billing_paypal_error', { error_message: message })
      input.onError(message)
    },
  })

  const handler = async () => {
    const amountCredits = input.getAmountCredits()
    if (!Number.isInteger(amountCredits) || amountCredits < MIN_TOP_UP_CREDITS) {
      input.onError(`Enter at least ${MIN_TOP_UP_CREDITS.toLocaleString('en-US')} credits.`)
      return
    }
    capture('billing_checkout_started', { amount_credits: amountCredits })
    input.onStatus('Opening PayPal…')
    try {
      await session.start(
        { presentationMode: 'auto' },
        (async () => {
          const res = await fetch('/api/billing/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amountCredits }),
          })
          const body = await res.json().catch(() => null)
          if (!res.ok || typeof body?.orderId !== 'string') {
            throw new Error(
              typeof body?.error === 'string' ? body.error : `Create order failed (${res.status})`,
            )
          }
          return { orderId: body.orderId }
        })(),
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      capture('billing_checkout_create_order_failed', {
        amount_credits: amountCredits,
        error_message: message,
      })
      input.onError(message)
    }
  }

  input.button.addEventListener('click', handler)
  return () => input.button.removeEventListener('click', handler)
}
