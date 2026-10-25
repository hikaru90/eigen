import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_MS,
  DbPoolAcquireTimeoutError,
  poolAcquireTimeoutMs,
  reserveWithTimeout,
} from './pool-acquire'

type Conn = { id: string; release: ReturnType<typeof vi.fn> }

function conn(id: string): Conn {
  return { id, release: vi.fn() }
}

describe('poolAcquireTimeoutMs', () => {
  afterEach(() => {
    delete process.env.DB_POOL_ACQUIRE_TIMEOUT_MS
  })

  it('defaults to 60s', () => {
    expect(DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_MS).toBe(60_000)
    expect(poolAcquireTimeoutMs()).toBe(60_000)
  })

  it('reads DB_POOL_ACQUIRE_TIMEOUT_MS', () => {
    process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = '2500'
    expect(poolAcquireTimeoutMs()).toBe(2500)
  })

  it.each(['0', '-5', '1.5', 'abc'])('rejects invalid DB_POOL_ACQUIRE_TIMEOUT_MS=%s', (raw) => {
    process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = raw
    expect(() => poolAcquireTimeoutMs()).toThrow(
      /DB_POOL_ACQUIRE_TIMEOUT_MS must be a positive integer/,
    )
  })
})

describe('reserveWithTimeout', () => {
  it('returns the connection when the pool hands one out in time', async () => {
    const c = conn('a')
    await expect(
      reserveWithTimeout(() => Promise.resolve(c), { poolName: 'app', max: 10, timeoutMs: 1000 }),
    ).resolves.toBe(c)
    expect(c.release).not.toHaveBeenCalled()
  })

  it('propagates reserve errors unchanged', async () => {
    const boom = new Error('connection refused')
    await expect(
      reserveWithTimeout(() => Promise.reject(boom), { poolName: 'app', max: 10, timeoutMs: 1000 }),
    ).rejects.toBe(boom)
  })

  it('throws a named DbPoolAcquireTimeoutError when no connection frees up', async () => {
    const never = new Promise<Conn>(() => {})
    const err = await reserveWithTimeout(() => never, {
      poolName: 'app',
      max: 10,
      timeoutMs: 25,
    }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DbPoolAcquireTimeoutError)
    const typed = err as DbPoolAcquireTimeoutError
    expect(typed.name).toBe('DbPoolAcquireTimeoutError')
    expect(typed.poolName).toBe('app')
    expect(typed.max).toBe(10)
    expect(typed.timeoutMs).toBe(25)
    expect(typed.message).toContain('25ms')
    expect(typed.message).toContain('app')
    expect(typed.message).toContain('max 10')
    expect(typed.message).toMatch(/nest/i)
    expect(typed.message).toContain('DB_POOL_MAX')
  })

  it('releases a connection that arrives after the timeout instead of leaking it', async () => {
    let resolveLate!: (c: Conn) => void
    const late = new Promise<Conn>((resolve) => {
      resolveLate = resolve
    })
    await expect(
      reserveWithTimeout(() => late, { poolName: 'app', max: 1, timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(DbPoolAcquireTimeoutError)

    const c = conn('late')
    resolveLate(c)
    await vi.waitFor(() => expect(c.release).toHaveBeenCalledTimes(1))
  })

  it('does not time out once the connection was handed out', async () => {
    vi.useFakeTimers()
    try {
      const c = conn('a')
      const result = await reserveWithTimeout(() => Promise.resolve(c), {
        poolName: 'billing',
        max: 5,
        timeoutMs: 50,
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(result).toBe(c)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
