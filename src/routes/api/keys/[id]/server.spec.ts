import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiErrorBody } from '$lib/server/http/api-error'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

import { DELETE } from './+server'

function deleteEvent(overrides: { user?: { id: string } | null; id?: string } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { id: overrides.id ?? 'key-1' },
  } as Parameters<typeof DELETE>[0]
}

function selectLimit(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  return { from, where, limit }
}

function updateChain() {
  const where = vi.fn(async () => undefined)
  const set = vi.fn(() => ({ where }))
  return { set, where }
}

describe('DELETE /api/keys/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const res = await DELETE(deleteEvent({ user: null }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(isApiErrorBody(body)).toBe(true)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 404 when key is missing for the user', async () => {
    const select = vi.fn(() => selectLimit([]))
    getDbMock.mockReturnValue({ select, update: vi.fn() })

    const res = await DELETE(deleteEvent({ id: 'missing' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(isApiErrorBody(body)).toBe(true)
    expect(body.error).toBe('Not found')
  })

  it('soft-deletes the key by setting isActive false', async () => {
    const select = vi.fn(() => selectLimit([{ id: 'key-1' }]))
    const update = updateChain()
    getDbMock.mockReturnValue({ select, update: vi.fn(() => update) })

    const res = await DELETE(deleteEvent({ id: 'key-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(update.set).toHaveBeenCalledWith({ isActive: false })
    expect(update.where).toHaveBeenCalledTimes(1)
  })
})
