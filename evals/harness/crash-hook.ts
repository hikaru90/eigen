import { AsyncLocalStorage } from 'node:async_hooks'
import type { EvalLlmCacheEvent } from '$lib/server/llm/eval-llm-cache'

/**
 * Kill-rehearsal support, eval CLI only. `EVAL_CRASH_AT=<phase>:<n>` (phase `ingest` or
 * `answer`) makes the process send itself SIGKILL right after the n-th completed paid call of
 * that phase - the call's response is already in the cache and its debit is booked, so the
 * resume must complete the run without paying for anything that finished before the kill.
 *
 * The hook only ever sees events of the eval response cache, which only the eval CLI turns on
 * and only harness tenants can use. Entry points that do not support the hook refuse to start
 * with the variable set (`refuseCrashHook`) instead of ignoring it, and production refuses it.
 */

export const CRASH_PHASES = ['ingest', 'answer'] as const
export type CrashPhase = (typeof CRASH_PHASES)[number]
export type CallPhase = CrashPhase | 'other'
export type CrashSpec = { phase: CrashPhase; n: number }

export function parseCrashSpec(raw: string | undefined): CrashSpec | null {
  if (raw === undefined || raw.trim() === '') return null
  const parts = raw.trim().split(':')
  const phase = CRASH_PHASES.find((p) => p === parts[0])
  const n = parts.length === 2 && /^\d+$/.test(parts[1]!) ? Number(parts[1]) : Number.NaN
  if (phase === undefined || !Number.isInteger(n) || n < 1) {
    throw new Error(
      `EVAL_CRASH_AT must be <phase>:<n> with phase ${CRASH_PHASES.join(' or ')} and n a positive integer, got: ${JSON.stringify(raw)}`,
    )
  }
  return { phase, n }
}

/** The armed crash of the eval CLI's environment (null = not armed). Refuses production. */
export function resolveCrashSpec(
  env: Readonly<Record<string, string | undefined>>,
): CrashSpec | null {
  const spec = parseCrashSpec(env.EVAL_CRASH_AT)
  if (spec !== null && env.NODE_ENV === 'production') {
    throw new Error('EVAL_CRASH_AT is an eval-only crash hook and must never be set in production')
  }
  return spec
}

/** For entry points without the hook: a set variable is a mistake, never silently ignored. */
export function refuseCrashHook(
  env: Readonly<Record<string, string | undefined>>,
  entry: string,
): void {
  if (env.EVAL_CRASH_AT !== undefined && env.EVAL_CRASH_AT.trim() !== '') {
    throw new Error(
      `EVAL_CRASH_AT is set but ${entry} does not support the crash hook; it only works in the PersonaMem eval CLI (unset it)`,
    )
  }
}

export type PhaseCounters = Record<CallPhase, { paid: number; hits: number }>

export type CallAccounting = {
  /** Tags every call made inside `fn` (this async context only) with `phase`. */
  withPhase<T>(phase: CrashPhase, fn: () => Promise<T>): Promise<T>
  /** The cache's event sink. */
  observe(event: EvalLlmCacheEvent): void
  counters(): PhaseCounters
}

export function createCallAccounting(input: {
  crash: CrashSpec | null
  /** Sends the SIGKILL (injectable for tests). */
  kill: () => void
  /** Reports the crash durably before the kill. */
  onCrash: (info: { phase: CrashPhase; n: number; counters: PhaseCounters }) => void
}): CallAccounting {
  const phaseStore = new AsyncLocalStorage<CrashPhase>()
  const counters: PhaseCounters = {
    ingest: { paid: 0, hits: 0 },
    answer: { paid: 0, hits: 0 },
    other: { paid: 0, hits: 0 },
  }
  return {
    withPhase: (phase, fn) => phaseStore.run(phase, fn),
    counters: () => structuredClone(counters),
    observe(event) {
      const phase = phaseStore.getStore()
      const bucket = counters[phase ?? 'other']
      if (event.kind === 'hit') {
        bucket.hits += 1
        return
      }
      bucket.paid += 1
      if (input.crash !== null && phase === input.crash.phase && bucket.paid === input.crash.n) {
        input.onCrash({ phase, n: bucket.paid, counters: structuredClone(counters) })
        input.kill()
      }
    },
  }
}

/** The real kill: SIGKILL to this process, no handlers, no flush. */
export const killSelf = (): void => {
  process.kill(process.pid, 'SIGKILL')
}
