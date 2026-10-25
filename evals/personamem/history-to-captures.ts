import type { ChatHistory } from './types'

/** Histories carry no dates; order is what matters (D3). */
export const DAY_MS = 24 * 60 * 60 * 1000

export const PERSONAMEM_EPOCH = new Date('2025-01-01T00:00:00.000Z')

export type CaptureItem = {
  rawText: string
  capturedAt: Date
}

/**
 * D2/D3: one capture per user turn; the system persona dump and assistant turns are never
 * captured. The n-th user turn is stamped epoch + n days: composeAnswer shows memories as
 * `stored=YYYY-MM-DD`, so minute spacing would make an updated preference indistinguishable from
 * the old one. The longest history (~136 user turns) stays under its 6-month staleness threshold.
 */
export function historyToCaptures(history: ChatHistory): CaptureItem[] {
  const captures: CaptureItem[] = []
  history.chat_history.forEach((message, index) => {
    if (message.role !== 'user') return
    const rawText = message.content.trim()
    if (!rawText) throw new Error(`[personamem] empty user turn at message ${index}`)
    captures.push({
      rawText,
      capturedAt: new Date(PERSONAMEM_EPOCH.getTime() + captures.length * DAY_MS),
    })
  })
  if (captures.length === 0) throw new Error('[personamem] history has no user turns')
  return captures
}

/**
 * Smoke mode (D2/D3 on the evidence only): the user turns of a question's evidence snippet,
 * in snippet order, stamped epoch + n days like `historyToCaptures`. Assistant turns are dropped.
 */
export function evidenceToCaptures(
  evidenceTurns: readonly { role: string; content: string }[],
): CaptureItem[] {
  const captures: CaptureItem[] = []
  for (const turn of evidenceTurns) {
    if (turn.role !== 'user') continue
    const rawText = turn.content.trim()
    if (!rawText) throw new Error('[personamem] empty user turn in evidence')
    captures.push({
      rawText,
      capturedAt: new Date(PERSONAMEM_EPOCH.getTime() + captures.length * DAY_MS),
    })
  }
  if (captures.length === 0) throw new Error('[personamem] evidence has no user turns')
  return captures
}
