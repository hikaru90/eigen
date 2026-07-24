/**
 * Chat session bootstrap / stream-safety helpers.
 *
 * Prevents two races that leave the UI stuck on a user bubble with no answer:
 * 1. After "New chat", a late onMount must not auto-select sessions[0].
 * 2. While a stream is in flight, session loads must not replace live messages.
 */

export const CHAT_ACTIVE_SESSION_STORAGE_KEY = 'chat-active-session-id'
export const CHAT_PREFER_BLANK_STORAGE_KEY = 'chat-prefer-blank-session'

export type ChatSessionListItem = { id: string }

export type ChatBootstrapSelection =
  | { type: 'blank' }
  | { type: 'session'; sessionId: string }

export type ChatPreferBlankStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** Resolve which session (if any) onMount should open. */
export function resolveChatBootstrapSelection(input: {
  storedId: string | null
  sessions: ChatSessionListItem[]
  preferBlank: boolean
}): ChatBootstrapSelection {
  if (input.preferBlank) return { type: 'blank' }

  const stored =
    typeof input.storedId === 'string' && input.storedId.trim() ? input.storedId.trim() : null
  if (stored) {
    const match = input.sessions.find((s) => s.id === stored)
    if (match) return { type: 'session', sessionId: match.id }
  }

  const newest = input.sessions[0]
  if (newest) return { type: 'session', sessionId: newest.id }
  return { type: 'blank' }
}

/**
 * Session message fetches must not clobber an in-flight NDJSON stream.
 * Explicit sidebar picks should abort the stream first, then load.
 */
export function shouldReplaceMessagesWithSessionLoad(input: { streaming: boolean }): boolean {
  return !input.streaming
}

/**
 * Drop a session-messages response that was superseded by New chat / a new turn /
 * a newer selectSession while the fetch was in flight.
 */
export function shouldApplyLoadedSessionMessages(input: {
  loadEpoch: number
  currentEpoch: number
  streaming: boolean
}): boolean {
  if (input.loadEpoch !== input.currentEpoch) return false
  return shouldReplaceMessagesWithSessionLoad({ streaming: input.streaming })
}

export function readChatPreferBlank(storage: ChatPreferBlankStorage): boolean {
  return storage.getItem(CHAT_PREFER_BLANK_STORAGE_KEY) === '1'
}

export function setChatPreferBlank(storage: ChatPreferBlankStorage): void {
  storage.setItem(CHAT_PREFER_BLANK_STORAGE_KEY, '1')
}

export function clearChatPreferBlank(storage: ChatPreferBlankStorage): void {
  storage.removeItem(CHAT_PREFER_BLANK_STORAGE_KEY)
}
