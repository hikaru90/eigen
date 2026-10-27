/**
 * The text of the assistant's reply bubble, from the stream's `done.response`.
 *
 * The server has already settled it: the agent answer is sanitised there (`finalAnswerText`
 * in `$lib/server/chat/run-ask-turn`) and the server-written appendix — the proposed
 * thoughts, visible notes — is appended after it. The page therefore shows it as it is. Re-reading
 * it against the `answer_question` tool result swaps the whole reply for that tool's answer
 * and loses the appendix until the next reload.
 */
export function finalResponseText(response: string | undefined): string {
  const text = response?.trim() ?? ''
  if (!text) throw new Error('The assistant returned an empty response.')
  return text
}
