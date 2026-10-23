import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { loadYarnThoughtsMock } = vi.hoisted(() => ({ loadYarnThoughtsMock: vi.fn() }))

vi.mock('$lib/server/mesh/yarn-list', () => ({ loadYarnThoughts: loadYarnThoughtsMock }))

function event(search = '', user: { id: string } | null = { id: 'u1' }) {
  return { locals: { user }, url: new URL(`http://x/api/mesh/yarn${search}`) } as never
}

describe('GET /api/mesh/yarn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadYarnThoughtsMock.mockResolvedValue([{ id: 't1' }])
  })

  it('requires auth', async () => {
    await expect(GET(event('', null))).rejects.toMatchObject({ status: 401 })
    expect(loadYarnThoughtsMock).not.toHaveBeenCalled()
  })

  it('returns the tenant yarn with no author scope by default', async () => {
    const res = await GET(event())
    expect(await res.json()).toEqual({ thoughts: [{ id: 't1' }] })
    expect(loadYarnThoughtsMock).toHaveBeenCalledWith('u1', { author: undefined, authorLayerKey: null })
  })

  it.each([
    ['all', 'all'],
    ['agent', 'agent'],
    ['user', 'user'],
    ['bogus', undefined],
  ])('scopes author=%s to %s', async (param, expected) => {
    await GET(event(`?author=${param}`))
    expect(loadYarnThoughtsMock).toHaveBeenCalledWith('u1', { author: expected, authorLayerKey: null })
  })

  it('an agent layer key wins over the author param', async () => {
    await GET(event('?author=user&authorLayerKey=agent:claude'))
    expect(loadYarnThoughtsMock).toHaveBeenCalledWith('u1', {
      author: undefined,
      authorLayerKey: 'agent:claude',
    })
  })
})
