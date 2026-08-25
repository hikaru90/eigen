import { env } from '$lib/server/env/private-env'
import { isPayPalConfigured } from '$lib/server/billing/paypal'

/**
 * Whether Settings → LLM shows BYOK tabs and billing-mode switch.
 * Explicit `BILLING_BYOK_UI_ENABLED` overrides; when unset, BYOK is shown when PayPal is not configured (typical self-host).
 */
export function isByokUiEnabled(): boolean {
  const raw = env.BILLING_BYOK_UI_ENABLED?.trim().toLowerCase()
  if (raw === 'true') return true
  if (raw === 'false') return false
  return !isPayPalConfigured()
}
