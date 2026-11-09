/**
 * "Too big" on a Lightning question opens Ask at `/chat?breakdown=<cardId>` (NOW-9). The page's
 * server load turns the card into `breakdownTask`; on mount the page calls this once. It starts
 * a NEW conversation, takes `breakdown` out of the URL FIRST (so a reload can never send it
 * twice), then sends one ordinary user message. Ask's own rules apply from there: Jev judges the
 * message, `propose_thoughts`, nothing is stored until the user confirms.
 */
export type BreakdownStartDeps = {
  /** The localized user message for this task. */
  message: (task: string) => string
  startNewConversation: () => void
  /** Removes `breakdown` from the URL (the page's `setSessionUrl(null)`). */
  clearUrl: () => void
  appendUserMessage: (text: string) => void
  /** The page's streaming send with a message (not the briefing bootstrap). */
  send: (text: string) => Promise<void>
}

/** True when a message was sent; false when there is no task to break down. */
export async function startBreakdown(
  task: string | null,
  deps: BreakdownStartDeps,
): Promise<boolean> {
  if (!task) return false
  const text = deps.message(task)
  deps.startNewConversation()
  deps.clearUrl()
  deps.appendUserMessage(text)
  await deps.send(text)
  return true
}
