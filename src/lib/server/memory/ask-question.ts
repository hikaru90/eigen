/**
 * The suggested question for Ask (docs/planning/feature-ask-suggested-questions.md).
 *
 * The LLM decides the question (SQ-2) inside an existing enrichment call; this module owns
 * the shared prompt rule and the post-LLM contract check. Code never judges whether the
 * text is a "good" question — it only validates type and length and trims whitespace.
 */

export const ASK_QUESTION_MAX_CHARS = 90

export const ASK_QUESTION_RULE = [
  `askQuestion — one short, natural question (at most ${ASK_QUESTION_MAX_CHARS} characters) the user might later ask to get THIS capture back.`,
  "Write it in the same language as the capture, from the user's perspective in the first person (e.g. \"What did I need to tell the plumber?\", \"When is the dentist appointment?\").",
  'It must be answerable from this capture alone; never copy the capture text verbatim and never answer it.',
  'Use null when no sensible question exists (e.g. a greeting, a single word, noise).',
].join(' ')

/** Validate the `askQuestion` key of an LLM JSON object. Missing key / wrong type throws. */
export function parseAskQuestion(obj: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(obj, 'askQuestion')) {
    throw new Error('askQuestion: key missing from enrichment output')
  }
  const value = obj.askQuestion
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error(`askQuestion: expected string or null, got ${typeof value}`)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error('askQuestion: empty string (use null when there is no question)')
  }
  if (trimmed.length > ASK_QUESTION_MAX_CHARS) {
    throw new Error(`askQuestion: ${trimmed.length} chars exceeds ${ASK_QUESTION_MAX_CHARS}`)
  }
  return trimmed
}
