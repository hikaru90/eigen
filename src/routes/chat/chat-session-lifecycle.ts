/**
 * Chat session stream-safety helpers: while a stream is in flight, or after New chat /
 * a newer pick, a session load must not replace the live messages.
 */

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
