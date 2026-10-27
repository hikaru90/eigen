/**
 * The owner's correction as LLM context (docs/planning/capture-feedback.md, C5 follow-up): when the
 * owner votes a capture down with a reason, the thought is read again with that reason in the
 * prompt. It is context for the reading only: never persisted, never logged in plain text (a
 * length at most), and the same sentence in every prompt that takes it.
 */

/** The prompt block; a blank correction is an error (an empty one must not reach a prompt). */
export function ownerCorrectionBlock(correction: string): string {
  const text = correction.trim()
  if (text === '') throw new Error('[capture] ownerCorrection must not be blank')
  return `The owner said the last reading of this thought was wrong: "${text}". Read the thought again with that in mind.`
}
