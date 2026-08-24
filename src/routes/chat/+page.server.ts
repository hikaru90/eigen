import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { isByokBilling } from '$lib/server/billing/preferences'
import { getWalletSnapshot } from '$lib/server/billing/wallet'
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const userId = event.locals.user.id
  const [gate, byok, wallet] = await Promise.all([
    checkCaptureAllowed(userId),
    isByokBilling(userId),
    getWalletSnapshot(userId),
  ])

  return {
    captureGate: gate,
    billingMode: byok ? ('byok' as const) : ('platform_credits' as const),
    walletAvailableCredits: wallet.availableCredits,
    minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
  }
}
