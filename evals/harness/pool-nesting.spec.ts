/**
 * Connection-pool deadlock regression (PersonaMem `--tenant-concurrency 5` hung forever).
 *
 * Runs the REAL tenant scope (`withEvalDb`), the REAL billing gate (`usage-gate`,
 * `ensure-harness-credits`, `wallet`) and the REAL pool wrappers against a fake `postgres` whose
 * pools honour `max` and queue `reserve()` like postgres.js does. Before the fix every tenant
 * scope held one connection and the billing check reserved up to two more from the same pool, so
 * N scopes exhausted a pool of 10 as soon as 2N+1 > 10 and every scope waited for a connection
 * held by another one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handle = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  unsafe: (sql: string) => Promise<unknown[]>
  release: () => void
  sessionUser: string
  poolIndex: number
}

const fake = vi.hoisted(() => {
  type WalletOp = { op: string; sessionUser: string; poolIndex: number }
  type FakePoolState = {
    index: number
    max: number
    inUse: number
    peak: number
    ended: boolean
    waiters: Array<() => void>
  }
  const state = {
    pools: [] as FakePoolState[],
    walletOps: [] as WalletOp[],
    balances: new Map<string, number>(),
    defaultBalance: 1_000_000,
    reset() {
      state.pools = []
      state.walletOps = []
      state.balances = new Map()
    },
  }
  return state
})

vi.mock('$lib/server/env/private-env', () => ({
  env: { DATABASE_URL: 'postgres://test:test@localhost:5432/test' },
}))

vi.mock('postgres', () => ({
  default: (_url: string, opts: { max: number }) => {
    const pool = {
      index: fake.pools.length,
      max: opts.max,
      inUse: 0,
      peak: 0,
      ended: false,
      waiters: [] as Array<() => void>,
    }
    fake.pools.push(pool)
    const makeHandle = (): Handle => {
      const h = ((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join('?').includes('set_config')) h.sessionUser = String(values[0])
        return Promise.resolve([])
      }) as Handle
      h.unsafe = async () => []
      h.sessionUser = ''
      h.poolIndex = pool.index
      h.release = () => {
        pool.inUse -= 1
        pool.waiters.shift()?.()
      }
      return h
    }
    const take = (): Handle => {
      pool.inUse += 1
      pool.peak = Math.max(pool.peak, pool.inUse)
      return makeHandle()
    }
    return {
      options: { max: opts.max },
      end: async () => {
        pool.ended = true
      },
      reserve: () =>
        new Promise<Handle>((resolve) => {
          const attempt = () => {
            if (pool.inUse < pool.max) resolve(take())
            else pool.waiters.push(attempt)
          }
          attempt()
        }),
    }
  },
}))

// The wallet only needs a client that answers per RLS session user; everything else is real.
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: (client: Handle) => {
    const balanceOf = () => fake.balances.get(client.sessionUser) ?? fake.defaultBalance
    const record = (op: string) =>
      fake.walletOps.push({ op, sessionUser: client.sessionUser, poolIndex: client.poolIndex })
    const walletRow = () => ({
      userId: client.sessionUser,
      availableCredits: balanceOf(),
      reservedCredits: 0,
      pendingBillingMicroUsd: 0,
      currency: 'USD',
      updatedAt: new Date(),
    })
    const thenable = (op: string) => {
      const p = Promise.resolve().then(() => record(op))
      return Object.assign(p, { onConflictDoNothing: async () => record(`${op}:conflict`) })
    }
    const db = {
      insert: () => ({ values: () => thenable('insert') }),
      select: () => ({
        from: () => ({
          where: () => {
            const rows = async (op: string) => {
              record(op)
              return [walletRow()]
            }
            return { limit: () => rows('select'), for: () => rows('select-for-update') }
          },
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            record('update')
          },
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    }
    return db
  },
}))

const OPERATOR = 'public-bench-runner'
const tenantId = (i: number) => `public-bench-tenant-${i}`

async function loadModules() {
  vi.resetModules()
  const evalContext = await import('./eval-context')
  const usageGate = await import('$lib/server/billing/usage-gate')
  const wallet = await import('$lib/server/billing/wallet')
  return { ...evalContext, ...usageGate, ...wallet }
}

/** Resolves once `n` parties arrived, so every scope provably holds its connection at once. */
function barrier(n: number) {
  let arrived = 0
  let open!: () => void
  const gate = new Promise<void>((resolve) => {
    open = resolve
  })
  return async () => {
    arrived += 1
    if (arrived === n) open()
    await gate
  }
}

describe('tenant scopes + billing share a bounded pool without deadlocking', () => {
  beforeEach(() => {
    fake.reset()
    delete process.env.DB_POOL_MAX
    delete process.env.DB_BILLING_POOL_MAX
    delete process.env.DB_POOL_ACQUIRE_TIMEOUT_MS
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([4, 5, 6, 9])(
    '%i concurrent tenant scopes each pass the capture billing gate on a pool of 10',
    async (n) => {
      const { withEvalDb, assertCapturePipelineAffordable } = await loadModules()
      const arrived = barrier(n)

      await Promise.all(
        Array.from({ length: n }, (_, i) =>
          withEvalDb(
            tenantId(i),
            async () => {
              await arrived()
              await assertCapturePipelineAffordable(tenantId(i))
            },
            { billingUserId: OPERATOR },
          ),
        ),
      )

      const [appPool] = fake.pools
      expect(appPool.max).toBe(10)
      // Exactly one app-pool connection per scope: billing never reserves a second one from it.
      expect(appPool.peak).toBe(n)
      expect(fake.pools.every((p) => p.inUse === 0)).toBe(true)
    },
    5_000,
  )

  it('parallel LLM-style charges inside saturated tenant scopes complete', async () => {
    const { withEvalDb, chargePlatformUsageMicroUsd } = await loadModules()
    const n = 9
    const arrived = barrier(n)

    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        withEvalDb(
          tenantId(i),
          async () => {
            await arrived()
            // enrich runs several LLM calls concurrently inside one scope; each one debits
            await Promise.all(
              Array.from({ length: 4 }, () => chargePlatformUsageMicroUsd(OPERATOR, 1_500)),
            )
          },
          { billingUserId: OPERATOR },
        ),
      ),
    )

    expect(fake.pools[0].peak).toBe(n)
    expect(fake.pools.every((p) => p.inUse === 0)).toBe(true)
  }, 5_000)

  it('checks and tops up the same wallets as before: billing operator, then the tenant, then affordability on the billing user', async () => {
    const { withEvalDb, assertCapturePipelineAffordable } = await loadModules()

    await withEvalDb(tenantId(0), () => assertCapturePipelineAffordable(tenantId(0)), {
      billingUserId: OPERATOR,
    })

    const users = fake.walletOps.filter((o) => o.op === 'select').map((o) => o.sessionUser)
    expect(new Set(users)).toEqual(new Set([OPERATOR, tenantId(0)]))
    // ensureHarnessWalletCredits reads operator then tenant; assertCanAfford reads the billing user
    expect(users.at(-1)).toBe(OPERATOR)
    // RLS: every wallet statement ran under the session user whose wallet it touches
    expect(
      fake.walletOps.every((o) => o.sessionUser === OPERATOR || o.sessionUser === tenantId(0)),
    ).toBe(true)
  })

  it('debits the billing user, never the tenant, and not on the tenant connection', async () => {
    const { withEvalDb, chargePlatformUsageMicroUsd } = await loadModules()

    const debited = await withEvalDb(
      tenantId(0),
      () => chargePlatformUsageMicroUsd(OPERATOR, 1_500, { baseUsd: 0.0015 }),
      { billingUserId: OPERATOR },
    )

    expect(debited).toBe(1)
    const writes = fake.walletOps.filter((o) => o.op === 'update' || o.op === 'insert')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((o) => o.sessionUser === OPERATOR)).toBe(true)
    expect(fake.walletOps.some((o) => o.sessionUser === tenantId(0))).toBe(false)
  })

  it('fails an unaffordable non-harness user with InsufficientCreditsError and releases every connection', async () => {
    const { assertCapturePipelineAffordable, InsufficientCreditsError } = await loadModules()
    const { withDbUser } = await import('$lib/server/db')
    fake.balances.set('prod-user', 2)

    await expect(
      withDbUser('prod-user', () => assertCapturePipelineAffordable('prod-user')),
    ).rejects.toBeInstanceOf(InsufficientCreditsError)
    expect(fake.pools.every((p) => p.inUse === 0)).toBe(true)
  })

  it('a saturated pool fails loud with DbPoolAcquireTimeoutError instead of hanging', async () => {
    process.env.DB_POOL_MAX = '2'
    process.env.DB_POOL_ACQUIRE_TIMEOUT_MS = '50'
    const { withEvalDb } = await loadModules()
    const { DbPoolAcquireTimeoutError } = await import('$lib/server/db/pool-acquire')

    let releaseHolders!: () => void
    const hold = new Promise<void>((resolve) => {
      releaseHolders = resolve
    })
    const holders = [0, 1].map((i) => withEvalDb(tenantId(i), () => hold))
    await vi.waitFor(() => expect(fake.pools[0].inUse).toBe(2))

    await expect(withEvalDb(tenantId(2), async () => 'never')).rejects.toBeInstanceOf(
      DbPoolAcquireTimeoutError,
    )

    releaseHolders()
    await Promise.all(holders)
    expect(fake.pools[0].inUse).toBe(0)
  })
})
