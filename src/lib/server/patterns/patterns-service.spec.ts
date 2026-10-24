import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  select: vi.fn(),
  withDbUser: vi.fn(),
  overlays: vi.fn(),
  judge: vi.fn(),
  buildInput: vi.fn(),
}))

/** A drizzle-ish chain that resolves to [] wherever it is awaited. */
function chain(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (ok: (v: unknown) => unknown) => Promise.resolve([]).then(ok)
      return () => proxy
    },
  }
  const proxy: object = new Proxy({}, handler)
  return proxy
}

vi.mock('$lib/server/db', () => ({
  getDb: () => ({ select: () => chain() }),
  withDbUser: m.withDbUser,
}))
vi.mock('$lib/server/graph/community-overlays', () => ({ fetchGraphCommunityOverlays: m.overlays }))
vi.mock('$lib/server/graph/age', () => ({ fetchEntityRelationsAmong: vi.fn(async () => []) }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: vi.fn() }))
vi.mock('./patterns-judge', () => ({ runPatternsJudge: m.judge }))
vi.mock('./patterns-input', async (orig) => ({
  ...(await orig<typeof import('./patterns-input')>()),
  buildPatternsLlmInput: m.buildInput,
}))

import { clearPatternsCache, getPatternsForUser, warmPatternsForUser } from './patterns-service'

beforeEach(() => {
  vi.clearAllMocks()
  clearPatternsCache()
  m.overlays.mockResolvedValue([])
  m.buildInput.mockReturnValue({ thoughtCatalog: [{ id: 't1', summary: 'one' }] })
  m.judge.mockResolvedValue({ insight: 'You keep returning to one thread.', patterns: [] })
  m.withDbUser.mockImplementation((_userId: string, fn: () => Promise<unknown>) => fn())
})

describe('patterns service: computed in the background, ready on arrival', () => {
  it('the warm and the tab share one judge call; the tab then reads the cache', async () => {
    warmPatternsForUser('u1')
    const first = await getPatternsForUser('u1')
    expect(first.status).toBe('ok')
    expect(m.judge).toHaveBeenCalledTimes(1)
    await getPatternsForUser('u1')
    warmPatternsForUser('u1')
    expect(m.judge).toHaveBeenCalledTimes(1)
  })

  it('the warm runs on its own tenant connection', async () => {
    warmPatternsForUser('u1')
    expect(m.withDbUser).toHaveBeenCalledWith('u1', expect.any(Function))
    await getPatternsForUser('u1')
  })

  it('a failed warm is not cached: the tab retries and sees the failure itself', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.judge.mockRejectedValueOnce(new Error('gateway down'))
    warmPatternsForUser('u1')
    await expect(getPatternsForUser('u1')).rejects.toThrow('gateway down')
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    m.judge.mockRejectedValueOnce(new Error('still down'))
    await expect(getPatternsForUser('u1')).rejects.toThrow('still down')
    log.mockRestore()
  })
})
