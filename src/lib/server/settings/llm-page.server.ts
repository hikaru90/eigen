import type { RequestEvent } from '@sveltejs/kit'
import { redirect } from '@sveltejs/kit'
import {
  getPayPalClientId,
  getPayPalWebSdkUrl,
  getPayPalClientSecret,
} from '$lib/server/billing/paypal'
import { getOrCreateWallet } from '$lib/server/billing/wallet'

/** Settings → Credits: the wallet balance and the PayPal top-up. All AI usage bills credits. */
export async function loadLlmSettingsPage(event: RequestEvent) {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const wallet = await getOrCreateWallet(event.locals.user.id)

  let paypalConfigured: boolean
  let paypalClientId: string | null = null
  let paypalSdkUrl: string | null = null
  try {
    // Same resolution as the PayPal billing module, so env aliases (PAYPAL_URL / PAYPAL_SECRET)
    // work consistently; the secret getter throws when capture credentials are missing.
    paypalClientId = getPayPalClientId()
    paypalSdkUrl = getPayPalWebSdkUrl()
    getPayPalClientSecret()
    paypalConfigured = true
  } catch {
    paypalConfigured = false
  }

  return { wallet, paypalConfigured, paypalClientId, paypalSdkUrl }
}
