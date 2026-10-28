import type { Actions, PageServerLoad } from './$types'
import { fail, redirect } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import { MIN_CAPTURE_PIPELINE_CREDITS, STARTING_FREE_CREDITS } from '$lib/server/billing/credits'
import {
  getPayPalClientId,
  getPayPalWebSdkUrl,
  isPayPalConfigured,
} from '$lib/server/billing/paypal'
import { getOrCreateWallet, grantStartingFreeCredits } from '$lib/server/billing/wallet'
import { loadRecentCaptureThoughts } from '$lib/server/capture/load-recent-capture-thoughts'
import { getDb } from '$lib/server/db'
import { authDb } from '$lib/server/db/auth-db'
import { user } from '$lib/server/db/auth.schema'
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate'
import { ensureUserOntologySeeded } from '$lib/server/ontology-db'
import { loadThoughtKindOptions } from '$lib/server/thought/kind-options'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  const userId = event.locals.user.id

  const authUser = await authDb
    .select({ onboardingCompleted: user.onboardingCompleted, accountKind: user.accountKind })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)
    .then((rows) => rows[0])

  const isHarness = authUser?.accountKind === 'harness'

  // Independent chains run together; each keeps its own order (grant → wallet, seed → kinds).
  const [[captureGate, wallet], { recentThoughts, recentThoughtDetails }, kinds] =
    await Promise.all([
      (async () => {
        if (!isHarness) await grantStartingFreeCredits(userId)
        return Promise.all([checkCaptureAllowed(userId), getOrCreateWallet(userId)])
      })(),
      loadRecentCaptureThoughts(userId),
      // "Kept as …" can be corrected after keeping: the type menu offers every active kind
      ensureUserOntologySeeded(getDb(), userId).then(() => loadThoughtKindOptions(getDb(), userId)),
    ])

  const paypalConfigured = isPayPalConfigured()
  const paypalClientId = paypalConfigured ? getPayPalClientId() : null
  const paypalSdkUrl = paypalConfigured ? getPayPalWebSdkUrl() : null

  const creditsGatePassed = isHarness || wallet.availableCredits >= MIN_CAPTURE_PIPELINE_CREDITS

  return {
    user: event.locals.user,
    isHarness,
    onboardingCompleted: isHarness || authUser?.onboardingCompleted === true,
    walletAvailableCredits: wallet.availableCredits,
    minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
    startingFreeCredits: STARTING_FREE_CREDITS,
    paypalConfigured,
    paypalClientId,
    paypalSdkUrl,
    kinds,
    creditsGatePassed,
    captureAllowed: captureGate.allowed,
    captureGateReason: captureGate.allowed ? null : captureGate.reason,
    recentThoughts,
    recentThoughtDetails,
  }
}

export const actions: Actions = {
  completeOnboarding: async (event) => {
    if (!event.locals.user) {
      return fail(401, { message: 'Unauthorized' })
    }

    const gate = await checkCaptureAllowed(event.locals.user.id)
    if (!gate.allowed) {
      return fail(400, {
        message: 'Add credits before finishing onboarding.',
      })
    }

    await authDb
      .update(user)
      .set({ onboardingCompleted: true })
      .where(eq(user.id, event.locals.user.id))

    return { ok: true as const }
  },

  skipOnboarding: async (event) => {
    if (!event.locals.user) {
      return fail(401, { message: 'Unauthorized' })
    }

    await authDb
      .update(user)
      .set({ onboardingCompleted: true })
      .where(eq(user.id, event.locals.user.id))

    return { ok: true as const }
  },
}
