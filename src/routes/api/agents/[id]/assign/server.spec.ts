import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { assignMock } = vi.hoisted(() => ({
  assignMock: vi.fn(),
}))

vi.mock('$lib/server/agents/assign-thought', () => ({
  assignThoughtToAgent: assignMock,
}))

describe('POST /api/agents/[id]/assign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assignMock.mockResolvedValue({ assignmentId: 'as1' })
  })

  it('returns 401 without session', async () => {
    const res = await POST({
      locals: { user: null },
      params: { id: 'a1' },
      request: new Request('http://localhost', { method: 'POST', body: '{}' }),
    } as never)
    expect(res.status).toBe(401)
  })

  it('requires thoughtId', async () => {
    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { id: 'a1' },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    } as never)
    expect(res.status).toBe(400)
  })

  it('assigns thought to agent', async () => {
    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { id: 'a1' },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thoughtId: 't1' }),
      }),
    } as never)
    expect(res.status).toBe(201)
    expect(assignMock).toHaveBeenCalledWith({
      userId: 'u1',
      agentId: 'a1',
      thoughtId: 't1',
    })
  })

  it('maps not-found errors to 404', async () => {
    assignMock.mockRejectedValue(new Error('agent not found'))
    const res = await POST({
      locals: { user: { id: 'u1' } },
      params: { id: 'a1' },
      request: new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ thoughtId: 't1' }),
      }),
    } as never)
    expect(res.status).toBe(404)
  })
})
