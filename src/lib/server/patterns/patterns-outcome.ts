import type { PatternsResult } from './patterns-service'
import { isInsufficientCreditsError } from '$lib/server/billing/insufficient-credits'

/**
 * What the streamed Patterns promise settles to. It never rejects: a rejected streamed
 * promise reaches the client as an opaque `{ message: 'Internal Error' }`, which loses the reason.
 */
export type PatternsOutcome =
  | { kind: 'ready'; result: PatternsResult }
  | { kind: 'failed'; reason: 'insufficient_credits' }
  | { kind: 'failed'; reason: 'error'; message: string }

/** A readable message for any thrown value — never "[object Object]". */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err as { message: unknown }
    if (typeof message === 'string') return message
  }
  if (typeof err === 'object' && err !== null) return JSON.stringify(err)
  return String(err)
}

export async function resolvePatternsOutcome(run: Promise<PatternsResult>): Promise<PatternsOutcome> {
  try {
    return { kind: 'ready', result: await run }
  } catch (err) {
    console.error('[patterns] load failed', err)
    if (isInsufficientCreditsError(err)) return { kind: 'failed', reason: 'insufficient_credits' }
    return { kind: 'failed', reason: 'error', message: errorMessage(err) }
  }
}
