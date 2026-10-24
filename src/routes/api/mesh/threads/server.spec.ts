import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { loadThreadListMock } = vi.hoisted(() => ({ loadThreadListMock: vi.fn() }))

vi.mock('$lib/server/mesh/thread-list', () => ({ loadThreadList: loadThreadListMock }))

function event(search = '', user: { id: string } | null = { id: 'u1' }) {
  return { locals: { user }, url: new URL(`http://x/api/mesh/threads${search}`) } as never
}

describe('GET /api/mesh/threads', () => {
  const list = { threads: [{ entityId: 'p1' }], loose: { thoughtCount: 0, lastAddedIso: null } }

  beforeEach(() => {
    vi.clearAllMocks()
    loadThreadListMock.mockResolvedValue(list)
  })

  it('requires auth', async () => {
    await expect(GET(event('', null))).rejects.toMatchObject({ status: 401 })
    expect(loadThreadListMock).not.toHaveBeenCalled()
  })

  it.each([
    ['all', 'all'],
    ['agent', 'agent'],
    ['user', 'user'],
  ])('scopes author=%s to %s', async (param, expected) => {
    const res = await GET(event(`?author=${param}`))
    expect(await res.json()).toEqual(list)
    expect(loadThreadListMock).toHaveBeenCalledWith('u1', {
      author: expected,
      authorLayerKey: null,
    })
  })

  it('rejects a missing or unknown author scope instead of defaulting', async () => {
    await expect(GET(event())).rejects.toMatchObject({ status: 400 })
    await expect(GET(event('?author=bogus'))).rejects.toMatchObject({ status: 400 })
    expect(loadThreadListMock).not.toHaveBeenCalled()
  })

  it('an agent layer key wins over the author param', async () => {
    await GET(event('?author=user&authorLayerKey=agent:claude'))
    expect(loadThreadListMock).toHaveBeenCalledWith('u1', {
      author: undefined,
      authorLayerKey: 'agent:claude',
    })
  })
})
