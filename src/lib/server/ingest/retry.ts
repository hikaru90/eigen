/**
 * Deterministic ingest retry budget (AC-015, AC-016).
 * Caller supplies the async operation; this wrapper applies exactly `maxAttempts` tries
 * (initial + retries), so total attempts = 1 + maxRetries.
 *
 * Fatal errors (e.g. 402 billing) are NOT retried — they propagate immediately.
 */
export const INGEST_MAX_RETRIES = 3 as const

export type RetryExhaustedError = Error & { attempts: number; lastCause: unknown }

export class FatalIngestError extends Error {
  readonly cause: unknown
  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'FatalIngestError'
    this.cause = cause
  }
}

export function isFatalIngestError(e: unknown): e is FatalIngestError {
  return e instanceof FatalIngestError
}

/** True when the error is a non-transient failure (e.g. 402 billing) that should not be retried. */
function isNonRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'InsufficientCreditsError') return true
  // LLM HTTP 402 — insufficient balance at gateway level
  if (error.message.includes('LLM HTTP 402')) return true
  return false
}

export function isRetryExhaustedError(e: unknown): e is RetryExhaustedError {
  return e instanceof Error && 'attempts' in e && 'lastCause' in e
}

export async function runIngestWithRetries<T>(
  op: () => Promise<T>,
  maxRetries: number = INGEST_MAX_RETRIES,
): Promise<T> {
  let lastCause: unknown
  const maxAttempts = 1 + maxRetries
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op()
    } catch (e) {
      lastCause = e
      // Non-retryable errors propagate immediately
      if (isNonRetryable(e)) {
        throw new FatalIngestError(
          `Fatal ingest error (no retry): ${e instanceof Error ? e.message : String(e)}`,
          e,
        )
      }
      if (attempt === maxAttempts) break
    }
  }
  const causeDetail =
    lastCause instanceof Error && lastCause.cause != null ? ` (${String(lastCause.cause)})` : ''
  const err = new Error(
    `Ingest failed after ${maxAttempts} attempts (initial + ${maxRetries} retries). Last error: ${String(lastCause)}${causeDetail}`,
  ) as RetryExhaustedError
  err.attempts = maxAttempts
  err.lastCause = lastCause
  throw err
}
