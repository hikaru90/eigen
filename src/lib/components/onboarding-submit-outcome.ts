/**
 * Pure classification of a SvelteKit `ActionResult` for the onboarding
 * overlay. Extracted from `capture-onboarding-overlay.svelte` so the
 * failure semantics (401 session expiry, 400 credits gate, anything else)
 * are unit-testable outside the browser-only component config.
 *
 * Invariant kept intentionally simple: `completeOnboarding` failing with
 * 400 means the credits gate blocked it — the overlay falls back to the
 * ungated `skipOnboarding` action so the user is never stranded.
 */
export type SubmitOutcome =
  | { type: 'success' }
  | { type: 'failure'; status?: number }
  | { type: string; status?: number; [key: string]: unknown }

export type ResolvedSubmitOutcome =
  | { kind: 'success' }
  | { kind: 'credits_gate' }
  | { kind: 'auth' }
  | { kind: 'generic' }

export function resolveSubmitOutcome(result: SubmitOutcome | null | undefined): ResolvedSubmitOutcome {
  if (!result || typeof result !== 'object' || typeof result.type !== 'string') {
    return { kind: 'generic' }
  }
  if (result.type === 'success') return { kind: 'success' }
  if (result.type === 'failure') {
    if (result.status === 400) return { kind: 'credits_gate' }
    if (result.status === 401) return { kind: 'auth' }
  }
  return { kind: 'generic' }
}
