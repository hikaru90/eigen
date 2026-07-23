/**
 * Typed LLM gateway HTTP failure. Carries the numeric status so callers (ingest retry
 * budget, temporal degradation) classify fatal vs transient WITHOUT message string
 * matching. The message keeps the legacy `LLM HTTP <status>: …` format for log continuity.
 */
export class LlmHttpError extends Error {
  readonly status: number

  constructor(status: number, detail: string) {
    super(`LLM HTTP ${status}: ${detail}`)
    this.name = 'LlmHttpError'
    this.status = status
  }
}

export function isLlmHttpError(e: unknown): e is LlmHttpError {
  return e instanceof LlmHttpError
}
