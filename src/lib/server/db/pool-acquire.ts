/**
 * Bounded wait for a pooled Postgres connection.
 *
 * postgres.js has no acquisition timeout: `sql.reserve()` on a saturated pool queues forever.
 * When every connection is held by a scope that is itself waiting for another connection from
 * the same pool the process hangs silently (0% CPU, all connections idle in `ClientRead`).
 * Every `reserve()` therefore goes through {@link reserveWithTimeout}, which fails loud instead.
 */

export const DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_MS = 60_000

/** `DB_POOL_ACQUIRE_TIMEOUT_MS`: max time one `reserve()` may wait for a free connection. */
export function poolAcquireTimeoutMs(): number {
  const raw =
    (typeof process !== 'undefined' ? process.env.DB_POOL_ACQUIRE_TIMEOUT_MS : undefined) ?? ''
  if (!raw.trim()) return DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_MS
  const parsed = Number(raw.trim())
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) {
    throw new Error(`DB_POOL_ACQUIRE_TIMEOUT_MS must be a positive integer, got: ${raw}`)
  }
  return parsed
}

export class DbPoolAcquireTimeoutError extends Error {
  override name = 'DbPoolAcquireTimeoutError'

  constructor(
    readonly poolName: string,
    readonly max: number,
    readonly timeoutMs: number,
  ) {
    super(
      `Timed out after ${timeoutMs}ms waiting for a free connection in the ${poolName} database pool (max ${max}). ` +
        `Every connection is held. If a scope that already holds a ${poolName} connection acquires another one ` +
        `from the same pool, the pool deadlocks - fix the nesting. Otherwise raise DB_POOL_MAX or lower concurrency.`,
    )
  }
}

type Releasable = { release: () => unknown }

/**
 * Await `reserve()` for at most `timeoutMs`. A connection that arrives after the timeout is
 * released immediately (the caller already gave up on it), so a timeout never leaks one.
 */
export function reserveWithTimeout<R extends Releasable>(
  reserve: () => Promise<R>,
  opts: { poolName: string; max: number; timeoutMs: number },
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new DbPoolAcquireTimeoutError(opts.poolName, opts.max, opts.timeoutMs))
    }, opts.timeoutMs)

    reserve().then(
      (connection) => {
        if (settled) {
          void Promise.resolve()
            .then(() => connection.release())
            .catch(() => {})
          return
        }
        settled = true
        clearTimeout(timer)
        resolve(connection)
      },
      (err: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}
