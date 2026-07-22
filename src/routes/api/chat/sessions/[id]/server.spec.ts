import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

import { DELETE, GET } from './+server'

function event(overrides: { user?: { id: string } | null; id?: string } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    params: { id: overrides.id ?? 'sess-1' },
  } as Parameters<typeof GET>[0]
}

function selectLimit(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  return { from, where, limit }
}

function selectOrderBy(rows: unknown[]) {
  const orderBy = vi.fn(async () => rows)
  const where = vi.fn(() => ({ orderBy }))
  const from = vi.fn(() => ({ where }))
  return { from, where, orderBy }
}

describe('GET /api/chat/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(GET(event({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 404 when session does not exist', async () => {
    const select = vi.fn(() => selectLimit([]))
    getDbMock.mockReturnValue({ select })

    await expect(GET(event({ id: 'missing' }))).rejects.toMatchObject({ status: 404 })
  })

  it('returns session and ordered messages', async () => {
    const sessionSelect = selectLimit([{ id: 'sess-1', title: 'Hello' }])
    const messagesSelect = selectOrderBy([
      {
        id: 'm1',
        role: 'user',
        content: 'hi',
        metadata: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        role: 'assistant',
        content: 'hello',
        metadata: { tools: [] },
        createdAt: '2026-01-01T00:00:01.000Z',
      },
    ])
    const select = vi.fn().mockReturnValueOnce(sessionSelect).mockReturnValueOnce(messagesSelect)
    getDbMock.mockReturnValue({ select })

    const res = await GET(event({ id: 'sess-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      session: { id: 'sess-1', title: 'Hello' },
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hi',
          metadata: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'm2',
          role: 'assistant',
          content: 'hello',
          metadata: { tools: [] },
          createdAt: '2026-01-01T00:00:01.000Z',
        },
      ],
    })
    expect(select).toHaveBeenCalledTimes(2)
  })
})

describe('DELETE /api/chat/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(DELETE(event({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 404 when session does not exist', async () => {
    const select = vi.fn(() => selectLimit([]))
    getDbMock.mockReturnValue({ select, delete: vi.fn() })

    await expect(DELETE(event({ id: 'missing' }))).rejects.toMatchObject({ status: 404 })
  })

  it('deletes messages then session', async () => {
    const select = vi.fn(() => selectLimit([{ id: 'sess-1' }]))
    const deleteWhere = vi.fn(async () => undefined)
    const del = vi.fn(() => ({ where: deleteWhere }))
    getDbMock.mockReturnValue({ select, delete: del })

    const res = await DELETE(event({ id: 'sess-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
    expect(del).toHaveBeenCalledTimes(2)
    expect(deleteWhere).toHaveBeenCalledTimes(2)
  })
})
