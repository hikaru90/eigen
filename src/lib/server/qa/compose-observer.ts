import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'
import type { ComposedAnswer } from './compose-answer'

/**
 * Eval-only observer of the `answer_question` tool. Only the eval harness sets it; request code
 * never does. It lets a benchmark see the full context behind an Ask answer without changing
 * what the agent sees. Harness billing users only.
 */
const observerAsyncLocal = new AsyncLocalStorage<ComposedAnswer[]>()

function assertHarnessUser(userId: string): void {
  if (resolveHarnessBillingUserId(userId) === undefined) {
    throw new Error(`Compose observer is only allowed for harness billing users, not "${userId}"`)
  }
}

export async function withComposeObserver<T>(
  userId: string,
  fn: () => Promise<T>,
): Promise<{ result: T; observed: ComposedAnswer[] }> {
  assertHarnessUser(userId)
  const observed: ComposedAnswer[] = []
  const result = await observerAsyncLocal.run(observed, fn)
  return { result, observed }
}

/** Called by `answer_question` after composing; does nothing when no observer is set. */
export function observeComposedAnswer(userId: string, composed: ComposedAnswer): void {
  const observed = observerAsyncLocal.getStore()
  if (observed === undefined) return
  assertHarnessUser(userId)
  observed.push(composed)
}
