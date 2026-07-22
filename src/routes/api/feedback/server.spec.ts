import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiErrorBody } from '$lib/server/http/api-error'
import { POST } from './+server'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

function event(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    request: new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? { message: 'Great app!' }),
    }),
  } as Parameters<typeof POST>[0]
}

function mockInsert(returnValue: { id: string } = { id: 'fb1' }) {
  const returning = vi.fn(async () => [returnValue])
  const values = vi.fn(() => ({ returning }))
  const insert = vi.fn(() => ({ values }))
  getDbMock.mockReturnValue({ insert })
  return { insert, values, returning }
}

describe('POST /api/feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await POST(event({ user: null }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(isApiErrorBody(body)).toBe(true)
    expect(body.error).toBe('Unauthorized')
  })

  it('rejects invalid JSON with 400', async () => {
    const res = await POST({
      locals: { user: { id: 'u1' } },
      request: new Request('http://localhost/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      }),
    } as Parameters<typeof POST>[0])
    expect(res.status).toBe(400)
  })

  it('rejects empty message with 400', async () => {
    const { insert } = mockInsert()
    const res = await POST(event({ body: { message: '   ' } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/message/i)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects missing message with 400', async () => {
    const { insert } = mockInsert()
    const res = await POST(event({ body: {} }))
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects non-string message with 400', async () => {
    const { insert } = mockInsert()
    const res = await POST(event({ body: { message: 42 } }))
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects oversized message with 400', async () => {
    const { insert } = mockInsert()
    const res = await POST(event({ body: { message: 'x'.repeat(4001) } }))
    expect(res.status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
  })

  it('accepts a message of exactly the max length', async () => {
    const { values } = mockInsert()
    const res = await POST(event({ body: { message: 'x'.repeat(4000) } }))
    expect(res.status).toBe(201)
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }))
  })

  it('persists feedback scoped to the authenticated user and returns id', async () => {
    const { insert, values } = mockInsert({ id: 'fb-xyz' })
    const res = await POST(event({ body: { message: '  Love it  ' } }))
    expect(res.status).toBe(201)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', message: 'Love it' }),
    )
    const body = await res.json()
    expect(body).toEqual({ ok: true, id: 'fb-xyz' })
  })

  it('ignores extra fields and only stores the message', async () => {
    const { values } = mockInsert()
    await POST(event({ body: { message: 'hi', role: 'admin', id: 'evil' } }))
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', message: 'hi' }))
  })
})
