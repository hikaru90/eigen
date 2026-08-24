import { CREDITS_PER_USD } from '$lib/server/billing/credits'
import type { InsufficientCreditsError } from '$lib/server/billing/wallet'

export const INSUFFICIENT_CREDITS_CODE = 'insufficient_credits' as const

export type InsufficientCreditsPayload = {
  error: string
  code: typeof INSUFFICIENT_CREDITS_CODE
  availableCredits: number
  requiredCredits?: number
  phase?: 'precheck' | 'settle'
  creditsPerUsd: number
}

export function insufficientCreditsPayload(
  err: InsufficientCreditsError,
): InsufficientCreditsPayload {
  return {
    error: err.message,
    code: INSUFFICIENT_CREDITS_CODE,
    availableCredits: err.availableCredits ?? 0,
    ...(err.requiredCredits !== undefined ? { requiredCredits: err.requiredCredits } : {}),
    phase: err.phase,
    creditsPerUsd: CREDITS_PER_USD,
  }
}

export function isInsufficientCreditsError(err: unknown): err is InsufficientCreditsError {
  return err instanceof Error && err.name === 'InsufficientCreditsError'
}

export function billingErrorHttpStatus(err: unknown): number {
  return isInsufficientCreditsError(err) ? 402 : 500
}

export function billingErrorJsonBody(
  err: unknown,
  fallbackMessage: string,
): Record<string, unknown> {
  if (isInsufficientCreditsError(err)) {
    return insufficientCreditsPayload(err)
  }
  const message = err instanceof Error ? err.message : fallbackMessage
  return { error: message }
}
