import { describe, expect, it, vi } from 'vitest'

// These specs mock `postgres` entirely (no real connection is ever opened), but
// runtime URL normalization still requires the env key — CI runs env-less, so
// stub the env source.
vi.mock('$lib/server/env/private-env', () => ({
  env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
}))

const { endMock, drizzleMock, reserveMock } = vi.hoisted(() => ({
  endMock: vi.fn(async () => undefined),
  drizzleMock: vi.fn(() => ({ mocked: true })),
  reserveMock: vi.fn(),
}))

vi.mock('postgres', () => ({
  default: vi.fn(() => ({
    end: endMock,
    options: { host: 'localhost' },
    reserve: reserveMock,
  })),
}))

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: drizzleMock,
}))

type ReservedMock = ((...args: unknown[]) => Promise<unknown>) & {
  unsafe: ReturnType<typeof vi.fn>
  tagCalls: unknown[][]
}

/** Mimic the callable `postgres.js` `Sql` handle: tag-template + identifier + `.unsafe()`. */
function makeReservedMock(): ReservedMock {
  const tagCalls: unknown[][] = []
  const reserved = ((...args: unknown[]) => {
    tagCalls.push(args)
    return Promise.resolve(undefined)
  }) as ReservedMock
  reserved.unsafe = vi.fn(async () => undefined)
  reserved.tagCalls = tagCalls
  return reserved
}

describe('db/index', () => {
  it('withDbUser scopes the session user and releases the reserved connection', async () => {
    const release = vi.fn(async () => undefined)
    const reserved = Object.assign(
      vi.fn(async () => undefined),
      {
        release,
        unsafe: vi.fn(async () => undefined),
      },
    )
    reserveMock.mockResolvedValue(reserved)

    const { withDbUser } = await import('./index')
    const fn = vi.fn(async () => 'scoped')

    await expect(withDbUser('user-123', fn)).resolves.toBe('scoped')
    expect(reserved).toHaveBeenCalled()
    expect(reserved.unsafe).toHaveBeenCalled()
    expect(release).toHaveBeenCalled()
    expect(fn).toHaveBeenCalled()
  }, 10_000)

  it('closeAppDbPool closes postgres pool', async () => {
    const { closeAppDbPool } = await import('./index')
    await closeAppDbPool()
    expect(endMock).toHaveBeenCalled()
  })

  it('createScopedDrizzle attaches options and returns drizzle db', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = {} as never
    const db = createScopedDrizzle(reserved)
    expect((reserved as { options?: unknown }).options).toBeDefined()
    expect(drizzleMock).toHaveBeenCalled()
    expect(db).toEqual({ mocked: true })
  })

  it('createScopedDrizzle leaves an existing begin alone', async () => {
    const { createScopedDrizzle } = await import('./index')
    const existingBegin = vi.fn()
    const reserved = Object.assign(makeReservedMock(), { begin: existingBegin })
    createScopedDrizzle(reserved as never)
    expect((reserved as { begin: unknown }).begin).toBe(existingBegin)
  })

  it('attached begin(fn) commits and returns the callback result', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (fn: (sql: unknown) => unknown) => Promise<unknown>
    }
    const out = await extended.begin(async (sql) => {
      expect(sql).toBe(reserved)
      return 'ok'
    })
    expect(out).toBe('ok')
    expect(reserved.unsafe).toHaveBeenCalledWith('begin')
    expect(reserved.unsafe).toHaveBeenCalledWith('commit')
  })

  it('attached begin(options, fn) sanitizes options and commits', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (options: string, fn: (sql: unknown) => unknown) => Promise<unknown>
    }
    await extended.begin('read only; drop tables', async () => 42)
    expect(reserved.unsafe).toHaveBeenCalledWith('begin read only drop tables')
    expect(reserved.unsafe).toHaveBeenCalledWith('commit')
  })

  it('attached begin(options, fn) throws when callback is missing', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (options: string) => Promise<unknown>
    }
    await expect(extended.begin('read only')).rejects.toThrow(/requires a callback/)
  })

  it('attached begin rolls back when the callback throws', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (fn: (sql: unknown) => unknown) => Promise<unknown>
    }
    await expect(
      extended.begin(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(reserved.unsafe).toHaveBeenCalledWith('rollback')
  })

  it('savepoint(fn) releases on success', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (fn: (sql: unknown) => unknown) => Promise<unknown>
      savepoint?: (fn: (sql: unknown) => unknown) => Promise<unknown>
    }

    const captured: { savepoint?: (fn: (sql: unknown) => unknown) => Promise<unknown> } = {}
    await extended.begin(async () => {
      captured.savepoint = extended.savepoint
      return await extended.savepoint!(async () => 'inner')
    })
    expect(captured.savepoint).toBeTypeOf('function')
    expect(extended.savepoint).toBeUndefined()
    const tags = reserved.tagCalls.map((call) => (call[0] as string[])[0] ?? '').join(' | ')
    expect(tags).toContain('savepoint ')
    expect(tags).toContain('release savepoint ')
  })

  it('savepoint(name, fn) rolls back on error', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (fn: (sql: unknown) => unknown) => Promise<unknown>
      savepoint?: (name: string, fn: (sql: unknown) => unknown) => Promise<unknown>
    }

    await expect(
      extended.begin(async () => {
        await extended.savepoint!('s1', async () => {
          throw new Error('nope')
        })
      }),
    ).rejects.toThrow('nope')
    const tags = reserved.tagCalls.map((call) => (call[0] as string[])[0] ?? '').join(' | ')
    expect(tags).toContain('rollback to savepoint ')
  })

  it('savepoint throws when no callback is provided', async () => {
    const { createScopedDrizzle } = await import('./index')
    const reserved = makeReservedMock()
    createScopedDrizzle(reserved as never)
    const extended = reserved as ReservedMock & {
      begin: (fn: (sql: unknown) => unknown) => Promise<unknown>
      savepoint?: (name?: unknown) => Promise<unknown>
    }

    await expect(
      extended.begin(async () => {
        await extended.savepoint!('orphan')
      }),
    ).rejects.toThrow(/savepoint requires a callback/)
  })

  it('throws when DB_POOL_MAX is not a positive integer', async () => {
    const prev = process.env.DB_POOL_MAX
    process.env.DB_POOL_MAX = 'not-a-number'
    vi.resetModules()
    // Pool init is lazy: the invalid value throws on first pool access, not at import.
    const { appSql } = await import('./index')
    expect(() => appSql.options).toThrow(/DB_POOL_MAX must be a positive integer/)
    vi.resetModules()
    if (prev === undefined) delete process.env.DB_POOL_MAX
    else process.env.DB_POOL_MAX = prev
  })

  describe('billing pool and bounded acquisition', () => {
    function makeReserved() {
      const release = vi.fn(async () => undefined)
      const reserved = Object.assign(
        vi.fn(async () => undefined),
        { release, unsafe: vi.fn(async () => undefined) },
      )
      return { reserved, release }
    }

    it('withBillingDbUser scopes the session user and releases the billing connection', async () => {
      vi.resetModules()
      const { reserved, release } = makeReserved()
      reserveMock.mockReset()
      reserveMock.mockResolvedValue(reserved)
      const { withBillingDbUser } = await import('./index')
      const { tenantUserAsyncLocal } = await import('$lib/server/billing/context')

      const seen = await withBillingDbUser('operator-1', async () =>
        tenantUserAsyncLocal.getStore(),
      )

      expect(seen).toBe('operator-1')
      expect(reserved).toHaveBeenCalled()
      expect(release).toHaveBeenCalledTimes(1)
    })

    it('getDb() inside a billing scope is the billing connection', async () => {
      vi.resetModules()
      const { reserved } = makeReserved()
      reserveMock.mockReset()
      reserveMock.mockResolvedValue(reserved)
      const { withBillingDbUser, getDb } = await import('./index')

      const scoped = await withBillingDbUser('operator-1', async (db) => ({ db, ambient: getDb() }))

      expect(scoped.ambient).toBe(scoped.db)
    })

    it('nested billing scope for the same user reuses the held connection', async () => {
      vi.resetModules()
      const { reserved } = makeReserved()
      reserveMock.mockReset()
      reserveMock.mockResolvedValue(reserved)
      const { withBillingDbUser } = await import('./index')

      const out = await withBillingDbUser('operator-1', (outer) =>
        withBillingDbUser('operator-1', async (inner) => inner === outer),
      )

      expect(out).toBe(true)
      expect(reserveMock).toHaveBeenCalledTimes(1)
    })

    it('nested billing scope for another user fails loud instead of taking a second connection', async () => {
      vi.resetModules()
      const { reserved, release } = makeReserved()
      reserveMock.mockReset()
      reserveMock.mockResolvedValue(reserved)
      const { withBillingDbUser } = await import('./index')

      await expect(
        withBillingDbUser('operator-1', () => withBillingDbUser('tenant-2', async () => 'x')),
      ).rejects.toThrow(/must not nest across users/)
      expect(reserveMock).toHaveBeenCalledTimes(1)
      expect(release).toHaveBeenCalledTimes(1)
    })

    it('appSql.reserve() rejects with DbPoolAcquireTimeoutError when the pool never frees up', async () => {
      vi.resetModules()
      process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = '20'
      process.env.DB_POOL_MAX = '3'
      try {
        reserveMock.mockReset()
        reserveMock.mockReturnValue(new Promise(() => {}))
        const { appSql, DbPoolAcquireTimeoutError, withDbUser } = await import('./index')

        const err = await appSql.reserve().catch((e: unknown) => e)
        expect(err).toBeInstanceOf(DbPoolAcquireTimeoutError)
        expect(err).toMatchObject({ poolName: 'app', max: 3, timeoutMs: 20 })
        await expect(withDbUser('u', async () => 'x')).rejects.toBeInstanceOf(
          DbPoolAcquireTimeoutError,
        )
      } finally {
        delete process.env.DB_POOL_ACQUIRE_TIMEOUT_MS
        delete process.env.DB_POOL_MAX
      }
    })

    it('withBillingDbUser times out on a saturated billing pool and names it', async () => {
      vi.resetModules()
      process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = '20'
      process.env.DB_BILLING_POOL_MAX = '2'
      try {
        reserveMock.mockReset()
        reserveMock.mockReturnValue(new Promise(() => {}))
        const { withBillingDbUser, DbPoolAcquireTimeoutError } = await import('./index')
        const err = await withBillingDbUser('u', async () => 'x').catch((e: unknown) => e)
        expect(err).toBeInstanceOf(DbPoolAcquireTimeoutError)
        expect(err).toMatchObject({ poolName: 'billing', max: 2 })
      } finally {
        delete process.env.DB_POOL_ACQUIRE_TIMEOUT_MS
        delete process.env.DB_BILLING_POOL_MAX
      }
    })

    it('closing the app pool also closes the billing pool', async () => {
      vi.resetModules()
      const { reserved } = makeReserved()
      reserveMock.mockReset()
      reserveMock.mockResolvedValue(reserved)
      endMock.mockClear()
      const { withBillingDbUser, closeAppDbPool } = await import('./index')
      await withBillingDbUser('operator-1', async () => 'ok')

      await closeAppDbPool()

      expect(endMock).toHaveBeenCalledTimes(2)
    })

    it('throws when DB_BILLING_POOL_MAX is not a positive integer', async () => {
      vi.resetModules()
      process.env.DB_BILLING_POOL_MAX = '0'
      try {
        const { withBillingDbUser } = await import('./index')
        await expect(withBillingDbUser('u', async () => 'x')).rejects.toThrow(
          /DB_BILLING_POOL_MAX must be a positive integer/,
        )
      } finally {
        delete process.env.DB_BILLING_POOL_MAX
      }
    })
  })
})
