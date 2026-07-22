import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))

import { load } from './+page.server'

function makeKeysChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(async () => rows),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  return chain
}

describe('api-keys page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: vi.fn(() => makeKeysChain([])),
    })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns empty keys without throwing when authenticated', async () => {
    const user = { id: 'u1', email: 'a@b.c' }
    const result = await load({ locals: { user } } as never)

    expect(result.user).toEqual(user)
    expect(result.keys).toEqual([])
  })
})
