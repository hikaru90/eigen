import { describe, expect, it, vi } from 'vitest'
import { POST } from './+server'

const { emitAgentEventMock } = vi.hoisted(() => ({
  emitAgentEventMock: vi.fn(),
}))

vi.mock('$lib/server/agents/emit', () => ({
  emitAgentEvent: emitAgentEventMock,
}))

function event(user: { id: string } | null = { id: 'u1' }) {
  return { locals: { user }, params: { id: 'agent-1' } } as Parameters<typeof POST>[0]
}

describe('POST /api/agents/[id]/test', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await POST(event(null))
    expect(res.status).toBe(401)
  })

  it('emits a test webhook event for the agent', async () => {
    emitAgentEventMock.mockResolvedValue({ deliveries: [{ id: 'd1' }] })
    const res = await POST(event())
    expect(emitAgentEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        agentId: 'agent-1',
        eventType: 'webhook.test',
        payload: { message: 'Eigenmesh webhook test' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deliveries: [{ id: 'd1' }] })
  })
})
