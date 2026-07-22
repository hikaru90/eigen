import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET, POST } from './+server'

vi.mock('$lib/server/agents/service', () => ({
  listConnectedAgents: vi.fn(),
  createConnectedAgent: vi.fn(),
  parseSubscribedEvents: vi.fn((v: unknown) => (Array.isArray(v) ? v : [])),
}))

import { listConnectedAgents, createConnectedAgent } from '$lib/server/agents/service'

const listMock = vi.mocked(listConnectedAgents)
const createMock = vi.mocked(createConnectedAgent)

function event(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    request: new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof POST>[0]
}

describe('GET /api/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without session', async () => {
    const res = await GET(event({ user: null }) as Parameters<typeof GET>[0])
    expect(res.status).toBe(401)
  })

  it('lists agents for user', async () => {
    listMock.mockResolvedValue([{ id: 'a1', name: 'Bot' }] as never)
    const res = await GET(event() as Parameters<typeof GET>[0])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents).toHaveLength(1)
  })
})

describe('POST /api/agents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 without session', async () => {
    const res = await POST(event({ user: null }))
    expect(res.status).toBe(401)
  })

  it('creates agent and returns secrets once', async () => {
    createMock.mockResolvedValue({
      id: 'a1',
      signingSecret: 'eigen_wh_abc',
      callbackToken: 'eigen_cb_xyz',
    })
    const res = await POST(
      event({
        body: {
          name: 'Worker',
          webhookUrl: 'https://example.com/hook',
          subscribedEvents: ['thought.created'],
        },
      }),
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.signingSecret).toBe('eigen_wh_abc')
    expect(body.callbackToken).toBe('eigen_cb_xyz')
  })
})
