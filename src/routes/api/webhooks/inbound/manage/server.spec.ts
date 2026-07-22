import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET, POST } from './+server'

const { getDbMock, encryptTenantValueMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  encryptTenantValueMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptTenantValueMock,
}))

function selectChain(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const orderBy = vi.fn(async () => rows)
  const where = vi.fn(() => ({ orderBy, limit }))
  const from = vi.fn(() => ({ where }))
  return { from }
}

function insertChain(row: unknown) {
  const returning = vi.fn(async () => (row ? [row] : []))
  const values = vi.fn(() => ({ returning }))
  return { values }
}

function getEvent(user: { id: string } | null = { id: 'u1' }) {
  return { locals: { user } } as Parameters<typeof GET>[0]
}

function postEvent(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    request: new Request('http://localhost/api/webhooks/inbound/manage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof POST>[0]
}

describe('GET /api/webhooks/inbound/manage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(GET(getEvent(null))).rejects.toMatchObject({ status: 401 })
  })

  it('lists inbound webhook subscriptions for the user', async () => {
    const select = vi.fn(() =>
      selectChain([
        {
          id: 'sub-1',
          name: 'GitHub',
          slug: 'github',
          signatureMode: 'github',
          subscribedEvents: ['push'],
          enabled: true,
          agentId: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]),
    )
    getDbMock.mockReturnValue({ select })

    const res = await GET(getEvent())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.subscriptions).toHaveLength(1)
    expect(body.subscriptions[0]).toMatchObject({ id: 'sub-1', slug: 'github' })
  })
})

describe('POST /api/webhooks/inbound/manage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptTenantValueMock.mockResolvedValue('encrypted-secret')
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(POST(postEvent({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      POST({
        locals: { user: { id: 'u1' } },
        request: new Request('http://localhost', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as Parameters<typeof POST>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when name is missing', async () => {
    await expect(POST(postEvent({ body: {} }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 for an invalid signatureMode', async () => {
    await expect(
      POST(postEvent({ body: { name: 'Hook', signatureMode: 'bogus' } })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 for an invalid slug format', async () => {
    await expect(
      POST(postEvent({ body: { name: 'Hook', slug: 'Not Valid Slug!' } })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 409 when the slug already exists', async () => {
    const select = vi.fn(() => selectChain([{ id: 'existing' }]))
    getDbMock.mockReturnValue({ select })

    await expect(
      POST(postEvent({ body: { name: 'Hook', slug: 'my-hook' } })),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('creates a new inbound webhook subscription', async () => {
    const select = vi.fn(() => selectChain([]))
    const insert = vi.fn(() => insertChain({ id: 'sub-1' }))
    getDbMock.mockReturnValue({ select, insert })

    const res = await POST(postEvent({ body: { name: 'My Hook', slug: 'my-hook' } }))
    expect(encryptTenantValueMock).toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ id: 'sub-1', slug: 'my-hook', signatureMode: 'generic' })
    expect(body.signingSecret).toBeTruthy()
    expect(body.webhookUrl).toBe('/api/webhooks/inbound/my-hook')
  })

  it('generates a slug from the name when not provided', async () => {
    const select = vi.fn(() => selectChain([]))
    const insert = vi.fn(() => insertChain({ id: 'sub-2' }))
    getDbMock.mockReturnValue({ select, insert })

    const res = await POST(postEvent({ body: { name: 'My Cool Hook!' } }))
    const body = await res.json()
    expect(body.slug).toBe('my-cool-hook')
  })

  it('returns 500 when insert fails to return a row', async () => {
    const select = vi.fn(() => selectChain([]))
    const insert = vi.fn(() => insertChain(null))
    getDbMock.mockReturnValue({ select, insert })

    await expect(
      POST(postEvent({ body: { name: 'My Hook', slug: 'my-hook' } })),
    ).rejects.toMatchObject({ status: 500 })
  })
})
