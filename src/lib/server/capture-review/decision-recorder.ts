/**
 * Decision recorder: collects the ENFORCED Jev outcomes of one enrichment attempt so the capture
 * review (docs/planning/capture-feedback.md §3) can score them per capture.
 *
 * The decision log (`decision_shadow_log`) holds no thought id by contract, so it cannot say how
 * sure Jev was about one capture. The decision plane therefore also tells this recorder about every
 * authoritative answer at the moment it has it; the enrich pipeline wraps one attempt in
 * `withDecisionRecorder` and receives the list afterwards.
 *
 * Entries hold no text: the decision kind, the item ref (`m1`, `t2`, or the kind name for a whole-
 * thought decision), the chosen catalog key and Jev's probability for it. Outside a recorder scope
 * `recordDecision` does nothing, so every other caller of the decision plane is unaffected.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { DecisionKind } from '$lib/server/llm/decision-client'

export type RecordedDecision = {
  kind: DecisionKind
  /** Deterministic item surrogate (`m1`, `t2`), or the kind name for a whole-thought decision. Never text. */
  ref: string
  /** The chosen catalog key (ontology key or criteria key). */
  choice: string
  /** Jev's probability for the chosen answer, 0..1. */
  probability: number
}

const recorderStore = new AsyncLocalStorage<RecordedDecision[]>()

/**
 * Runs `fn` with a fresh recorder and returns its result with the decisions recorded while it ran
 * (including work `fn` started: ALS follows async continuations, so the parallel enrich steps are
 * covered). If `fn` throws, the error propagates and its decisions are dropped with the attempt.
 */
export async function withDecisionRecorder<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; decisions: RecordedDecision[] }> {
  const decisions: RecordedDecision[] = []
  const result = await recorderStore.run(decisions, fn)
  return { result, decisions: [...decisions] }
}

/**
 * Appends one enforced outcome when a recorder is active; a no-op otherwise. A malformed entry
 * inside a scope is a call-site bug and throws (the plane only passes validated Jev answers).
 */
export function recordDecision(entry: RecordedDecision): void {
  const decisions = recorderStore.getStore()
  if (!decisions) return
  if (entry.ref.trim() === '') {
    throw new Error(`[capture-review] recordDecision: ref must not be empty (kind ${entry.kind})`)
  }
  if (entry.choice.trim() === '') {
    throw new Error(
      `[capture-review] recordDecision: choice must not be empty (kind ${entry.kind})`,
    )
  }
  if (!Number.isFinite(entry.probability) || entry.probability < 0 || entry.probability > 1) {
    throw new Error(
      `[capture-review] recordDecision: probability must be within 0..1 (kind ${entry.kind}, ref ${entry.ref})`,
    )
  }
  decisions.push({
    kind: entry.kind,
    ref: entry.ref,
    choice: entry.choice,
    probability: entry.probability,
  })
}
