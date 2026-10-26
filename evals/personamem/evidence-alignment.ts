import type { CaptureItem } from './history-to-captures'

/**
 * Which history captures are a question's evidence. `related_conversation_snippet` is quoted
 * from the question's own history, so alignment is data matching by exact text (after the same
 * trim the captures get) — no similarity, no semantics.
 */

/**
 * pref_types whose evidence the dataset does not put in the 32k history: the evidence of every
 * `sensitive_info` row of the benchmark split (511 of 511) is a synthetic probe turn that
 * appears nowhere in the history. Their accuracy is still scored; they just have no evidence
 * to hit, and the evidence-hit metric leaves them out. Any other pref_type missing from its
 * history is a data or harness error and fails loud.
 */
export const PREF_TYPES_WITHOUT_HISTORY_EVIDENCE: readonly string[] = ['sensitive_info']

export class EvidenceNotInHistoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceNotInHistoryError'
  }
}

const clip = (text: string, max = 100) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

/**
 * Indexes (ascending, unique) into `captures` of every capture whose text equals one of the
 * evidence user turns. A text that occurs several times in the history counts every time.
 * Returns null for a pref_type whose evidence is by design not in the history, when none of it
 * is. Throws EvidenceNotInHistoryError naming the question and the turn otherwise.
 */
export function alignEvidenceToCaptures(
  captures: readonly CaptureItem[],
  evidenceTurns: readonly { role: string; content: string }[],
  question: { questionId: string; prefType: string },
): number[] | null {
  const userTurns = evidenceTurns.filter((t) => t.role === 'user').map((t) => t.content.trim())
  if (userTurns.length === 0) {
    throw new EvidenceNotInHistoryError(
      `[personamem] question ${question.questionId} (${question.prefType}): its evidence has no user turn`,
    )
  }

  const indexes = new Set<number>()
  const missing: string[] = []
  for (const text of userTurns) {
    const found = captures.flatMap((c, i) => (c.rawText === text ? [i] : []))
    if (found.length === 0) missing.push(text)
    for (const i of found) indexes.add(i)
  }

  if (missing.length === 0) return [...indexes].sort((a, b) => a - b)
  if (
    missing.length === userTurns.length &&
    PREF_TYPES_WITHOUT_HISTORY_EVIDENCE.includes(question.prefType)
  ) {
    return null
  }
  throw new EvidenceNotInHistoryError(
    `[personamem] question ${question.questionId} (${question.prefType}): evidence user turn not found in its history: "${clip(missing[0]!)}"` +
      (missing.length > 1 ? ` (and ${missing.length - 1} more)` : ''),
  )
}
