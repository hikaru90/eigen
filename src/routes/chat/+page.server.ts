import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { sessionMessagesToChatEntries } from '$lib/chat/normalize-messages'
import { MIN_CAPTURE_PIPELINE_CREDITS } from '$lib/server/billing/credits'
import { getWalletSnapshot } from '$lib/server/billing/wallet'
import { loadAskSuggestions } from '$lib/server/chat/ask-suggestions'
import { listChatSessions, loadChatSession } from '$lib/server/chat/chat-sessions'
import { checkCaptureAllowed } from '$lib/server/onboarding/capture-gate'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const userId = event.locals.user.id
  // The open conversation lives in the URL, so the page renders whole on the server.
  const sessionId = event.url.searchParams.get('session')?.trim() || null
  const [gate, wallet, sessions, active, suggestions] = await Promise.all([
    checkCaptureAllowed(userId),
    getWalletSnapshot(userId),
    listChatSessions(userId),
    sessionId ? loadChatSession(sessionId, userId) : Promise.resolve(null),
    loadAskSuggestions(userId),
  ])
  if (sessionId && !active) throw redirect(303, '/chat')

  return {
    captureGate: gate,
    walletAvailableCredits: wallet?.availableCredits ?? 0,
    minCaptureCredits: MIN_CAPTURE_PIPELINE_CREDITS,
    sessions,
    activeSessionId: active?.session.id ?? null,
    messages: active ? sessionMessagesToChatEntries(active.messages) : [],
    suggestions,
  }
}
