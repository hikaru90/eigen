import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  listConnectedAgentsMock,
  listProjectsForUserMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  listConnectedAgentsMock: vi.fn(),
  listProjectsForUserMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/agents/service', () => ({
  listConnectedAgents: listConnectedAgentsMock,
}))
vi.mock('$lib/server/memory/project-list', () => ({
  listProjectsForUser: listProjectsForUserMock,
}))

import { load } from './+page.server'

function makeJoinChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(async () => rows),
  }
  chain.from.mockReturnValue(chain)
  chain.innerJoin.mockReturnValue(chain)
  return chain
}

describe('settings/agents page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listConnectedAgentsMock.mockResolvedValue([])
    listProjectsForUserMock.mockResolvedValue([])
    getDbMock.mockReturnValue({
      select: vi.fn(() => makeJoinChain([])),
    })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    })
  })

  it('returns empty agents/projects/bindings without throwing when authenticated', async () => {
    const user = { id: 'u1', email: 'a@b.c' }
    const result = await load({ locals: { user } } as never)

    expect(result.user).toEqual(user)
    expect(result.agents).toEqual([])
    expect(result.projects).toEqual([])
    expect(result.agentProjectBindings).toEqual({})
    expect(listConnectedAgentsMock).toHaveBeenCalledWith('u1')
    expect(listProjectsForUserMock).toHaveBeenCalledWith('u1', { authorScope: 'all' })
  })
})
