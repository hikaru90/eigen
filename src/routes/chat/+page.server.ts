import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { ASK_SUGGESTION_COUNT, suggestionsFromRecentThoughts } from '$lib/chat/ask-suggestions'
import { sessionMessagesToChatEntries } from '$lib/chat/normalize-messages'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { isByokBilling } from '$lib/server/billing/preferences'
import { getWalletSnapshot } from '$lib/server/billing/wallet'
import { loadRecentCaptureThoughts } from '$lib/server/capture/load-recent-capture-thoughts'
import { listChatSessions, loadChatSession } from '$lib/server/chat/chat-sessions'
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate'

/** How many recent thoughts to read for the "Try asking" pills. */
const SUGGESTION_SOURCE_LIMIT = 8

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const userId = event.locals.user.id
  // The open conversation lives in the URL, so the page renders whole on the server.
  const sessionId = event.url.searchParams.get('session')?.trim() || null
  const [gate, byok, wallet, sessions, active, recent] = await Promise.all([
    checkCaptureAllowed(userId),
    isByokBilling(userId),
    getWalletSnapshot(userId),
    listChatSessions(userId),
    sessionId ? loadChatSession(sessionId) : Promise.resolve(null),
    loadRecentCaptureThoughts(userId, SUGGESTION_SOURCE_LIMIT, { author: 'user' }),
  ])
  if (sessionId && !active) throw redirect(303, '/chat')

  return {
    captureGate: gate,
    billingMode: byok ? ('byok' as const) : ('platform_credits' as const),
    walletAvailableCredits: wallet?.availableCredits ?? 0,
    minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
    sessions,
    activeSessionId: active?.session.id ?? null,
    messages: active ? sessionMessagesToChatEntries(active.messages) : [],
    suggestions: suggestionsFromRecentThoughts(recent.recentThoughts, { count: ASK_SUGGESTION_COUNT }),
  }
}
