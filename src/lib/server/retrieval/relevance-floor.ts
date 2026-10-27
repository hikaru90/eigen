import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import { COMPOSE_ANSWER_RELEVANCE_MIN } from './rrf-scoring'

/**
 * Eval-only override of the Q&A relevance floor (thoughts in `composeAnswer`). Only the eval
 * harness sets it; request code never does. Harness billing users only: reading it for any other
 * user while it is active throws. Without an override every caller gets
 * `COMPOSE_ANSWER_RELEVANCE_MIN`, unchanged.
 */
const relevanceFloorAsyncLocal = new AsyncLocalStorage<number>()

export function withEvalRelevanceFloor<T>(floor: number, fn: () => Promise<T>): Promise<T> {
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) {
    return Promise.reject(
      new Error(`Eval relevance floor must be a number in [0, 1], got ${String(floor)}`),
    )
  }
  return relevanceFloorAsyncLocal.run(floor, fn)
}

/** The floor for `userId`'s retrieval: the eval override when set, else the product constant. */
export function relevanceFloorFor(userId: string): number {
  const override = relevanceFloorAsyncLocal.getStore()
  if (override === undefined) return COMPOSE_ANSWER_RELEVANCE_MIN
  if (resolveHarnessBillingUserId(userId) === undefined) {
    throw new Error(
      `Eval relevance floor override ${override} is only allowed for harness billing users, not "${userId}"`,
    )
  }
  return override
}
