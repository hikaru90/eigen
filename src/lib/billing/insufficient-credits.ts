export const INSUFFICIENT_CREDITS_CODE = 'insufficient_credits' as const

export function isInsufficientCreditsChatError(
  err: unknown,
): err is Error & { code: typeof INSUFFICIENT_CREDITS_CODE; availableCredits?: number } {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code?: unknown }).code === INSUFFICIENT_CREDITS_CODE
  )
}

export function insufficientCreditsTopUpHint(err: {
  availableCredits?: number
  requiredCredits?: number
}): string {
  const available = err.availableCredits ?? 0
  const required = err.requiredCredits
  if (required !== undefined && required > 0) {
    return `Insufficient Eigen credits (available ${available.toLocaleString('en-US')}, need at least ${required.toLocaleString('en-US')}). Top up in Settings → Credits.`
  }
  return `Insufficient Eigen credits (available ${available.toLocaleString('en-US')}). Top up in Settings → Credits.`
}
