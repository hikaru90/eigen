import type { ComposedAnswer } from './compose-answer'
import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'

/**
 * The best candidate scores (0..1) that the Q&A relevance floor dropped in one compose call;
 * null = nothing was dropped on that side. Tells "nothing retrieved" apart from "just below".
 */
export type BelowFloorScores = { thoughts: number | null; notePassages: number | null }

type Observed = { composed: ComposedAnswer[]; belowFloor: BelowFloorScores[] }

/**
 * Eval-only observer of the `answer_question` tool and of composeAnswer's relevance floor. Only
 * the eval harness sets it; request code never does. It lets a benchmark see the full context
 * behind an Ask answer, and what just missed the floor, without changing what the agent sees.
 * Harness billing users only.
 */
const observerAsyncLocal = new AsyncLocalStorage<Observed>()

function assertHarnessUser(userId: string): void {
  if (resolveHarnessBillingUserId(userId) === undefined) {
    throw new Error(`Compose observer is only allowed for harness billing users, not "${userId}"`)
  }
}

export async function withComposeObserver<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<{ result: T; observed: ComposedAnswer[]; belowFloor: BelowFloorScores[] }> {
  assertHarnessUser(userId)
  const store: Observed = { composed: [], belowFloor: [] }
  const result = await observerAsyncLocal.run(store, fn)
  return { result, observed: store.composed, belowFloor: store.belowFloor }
}

/** Called by `answer_question` after composing; does nothing when no observer is set. */
export function observeComposedAnswer(userId: string, composed: ComposedAnswer): void {
  const store = observerAsyncLocal.getStore()
  if (store === undefined) return
  assertHarnessUser(userId)
  store.composed.push(composed)
}

/** Called by `composeAnswer` after its relevance floor; does nothing when no observer is set. */
export function observeBelowFloor(userId: string, scores: BelowFloorScores): void {
  const store = observerAsyncLocal.getStore()
  if (store === undefined) return
  assertHarnessUser(userId)
  store.belowFloor.push(scores)
}
