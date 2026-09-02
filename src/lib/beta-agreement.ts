/**
 * Shared gating logic for the early-access agreement modal.
 * Pure function so layout gating stays unit-testable without a DOM.
 */
export type BetaModalGateInput = {
  isLoggedIn: boolean
  accepted: boolean
  isAuthPath: boolean
}

export function shouldShowBetaModal({ isLoggedIn, accepted, isAuthPath }: BetaModalGateInput): boolean {
  return isLoggedIn && !accepted && !isAuthPath
}
