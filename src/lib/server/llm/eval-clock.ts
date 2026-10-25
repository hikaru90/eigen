import { AsyncLocalStorage } from 'node:async_hooks'
import { resolveHarnessBillingUserId } from '$lib/server/auth/harness-billing'

/**
 * Eval-only wall clock. Only the eval harness (`withEvalDb`) sets it; request code never
 * does. Consumers read it through `evalClockFor`, which refuses non-harness users.
 */
const evalClockAsyncLocal = new AsyncLocalStorage<Date>()

export function withEvalClock<T>(date: Date, fn: () => Promise<T>): Promise<T> {
  if (Number.isNaN(date.getTime())) {
    return Promise.reject(new Error('Invalid eval clock: expected a valid date'))
  }
  return evalClockAsyncLocal.run(new Date(date.getTime()), fn)
}

export function currentEvalClock(): Date | undefined {
  const clock = evalClockAsyncLocal.getStore()
  return clock === undefined ? undefined : new Date(clock.getTime())
}

/** The eval clock for `userId`, or undefined when none is set. Throws if set for a non-harness user. */
export function evalClockFor(userId: string): Date | undefined {
  const clock = currentEvalClock()
  if (clock === undefined) return undefined
  if (resolveHarnessBillingUserId(userId) === undefined) {
    throw new Error(
      `Eval clock "${clock.toISOString()}" is only allowed for harness billing users, not "${userId}"`,
    )
  }
  return clock
}
