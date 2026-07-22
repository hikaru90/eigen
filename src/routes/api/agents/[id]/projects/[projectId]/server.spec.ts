import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE } from './+server'

const { unbindMock } = vi.hoisted(() => ({
  unbindMock: vi.fn(),
}))

vi.mock('$lib/server/agents/service', () => ({
  unbindAgentFromProject: unbindMock,
}))

describe('DELETE /api/agents/[id]/projects/[projectId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unbindMock.mockResolvedValue(undefined)
  })

  it('returns 401 without session', async () => {
    const res = await DELETE({
      locals: { user: null },
      params: { id: 'a1', projectId: 'p1' },
    } as never)
    expect(res.status).toBe(401)
  })

  it('unbinds agent from project', async () => {
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { id: 'a1', projectId: 'p1' },
    } as never)
    expect(res.status).toBe(200)
    expect(unbindMock).toHaveBeenCalledWith({
      userId: 'u1',
      agentId: 'a1',
      projectEntityId: 'p1',
    })
  })

  it('maps not-found to 404', async () => {
    unbindMock.mockRejectedValue(new Error('binding not found'))
    const res = await DELETE({
      locals: { user: { id: 'u1' } },
      params: { id: 'a1', projectId: 'p1' },
    } as never)
    expect(res.status).toBe(404)
  })
})
