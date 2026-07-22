import { describe, expect, it, vi, beforeEach } from 'vitest'
import { DELETE, PATCH } from './+server'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

function updateChain(rows: unknown[]) {
  const returning = vi.fn(async () => rows)
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  return { set }
}

function deleteChain(rows: unknown[]) {
  const returning = vi.fn(async () => rows)
  const where = vi.fn(() => ({ returning }))
  return { where }
}

function patchEvent(overrides: { user?: { id: string } | null; body?: unknown; id?: string } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { id: overrides.id ?? 'sub-1' },
    request: new Request('http://localhost/api/webhooks/inbound/manage/sub-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(overrides.body ?? {}),
    }),
  } as Parameters<typeof PATCH>[0]
}

function deleteEvent(overrides: { user?: { id: string } | null; id?: string } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { id: overrides.id ?? 'sub-1' },
  } as Parameters<typeof DELETE>[0]
}

describe('PATCH /api/webhooks/inbound/manage/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(PATCH(patchEvent({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when id is missing', async () => {
    await expect(PATCH(patchEvent({ id: ' ' }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 for invalid JSON body', async () => {
    await expect(
      PATCH({
        locals: { user: { id: 'u1' } },
        params: { id: 'sub-1' },
        request: new Request('http://localhost', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: 'not-json',
        }),
      } as Parameters<typeof PATCH>[0]),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when name is empty', async () => {
    await expect(PATCH(patchEvent({ body: { name: '  ' } }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('returns 400 for an invalid signatureMode', async () => {
    await expect(PATCH(patchEvent({ body: { signatureMode: 'bogus' } }))).rejects.toMatchObject({
      status: 400,
    })
  })

  it('returns 400 when there are no fields to update', async () => {
    await expect(PATCH(patchEvent({ body: {} }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when the subscription is not found', async () => {
    getDbMock.mockReturnValue({ update: vi.fn(() => updateChain([])) })
    await expect(PATCH(patchEvent({ body: { enabled: false } }))).rejects.toMatchObject({
      status: 404,
    })
  })

  it('updates the subscription', async () => {
    getDbMock.mockReturnValue({ update: vi.fn(() => updateChain([{ id: 'sub-1' }])) })
    const res = await PATCH(patchEvent({ body: { name: 'Renamed', enabled: false } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('DELETE /api/webhooks/inbound/manage/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(DELETE(deleteEvent({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when id is missing', async () => {
    await expect(DELETE(deleteEvent({ id: ' ' }))).rejects.toMatchObject({ status: 400 })
  })

  it('returns 404 when the subscription is not found', async () => {
    getDbMock.mockReturnValue({ delete: vi.fn(() => deleteChain([])) })
    await expect(DELETE(deleteEvent())).rejects.toMatchObject({ status: 404 })
  })

  it('deletes the subscription', async () => {
    getDbMock.mockReturnValue({ delete: vi.fn(() => deleteChain([{ id: 'sub-1' }])) })
    const res = await DELETE(deleteEvent())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
