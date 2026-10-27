/**
 * Vocabulary of the capture-intent decision (docs/planning/personamem-score-plan.md, S2) and the
 * marker persisted on the capture's own thought. Pure — no DB, no LLM — so the decision plane
 * and the enrich worker share one source.
 */

/** store = the text is something to remember · forget = the user asks Eigen to forget something. */
export const CAPTURE_INTENTS = ['store', 'forget'] as const
export type CaptureIntent = (typeof CAPTURE_INTENTS)[number]

export function isCaptureIntent(value: unknown): value is CaptureIntent {
  return typeof value === 'string' && (CAPTURE_INTENTS as readonly string[]).includes(value)
}

/**
 * Reads the persisted intent off a capture's decrypted metadata (`metadata.captureIntent`).
 * Undefined = not decided yet. A marker outside the vocabulary throws — no silent default.
 */
export function readCaptureIntent(metadata: Record<string, unknown>): CaptureIntent | undefined {
  const marker = metadata.captureIntent
  if (marker === undefined || marker === null) return undefined
  if (!isCaptureIntent(marker)) {
    throw new Error(
      `captureIntent marker is malformed: must be one of ${CAPTURE_INTENTS.join(' | ')}`,
    )
  }
  return marker
}
