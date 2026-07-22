import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

import { GET, POST } from './+server'

function event(user: { id: string } | null) {
  return { locals: { user } } as Parameters<typeof GET>[0]
}

function cteSelectChain() {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({})),
        })),
      })),
    })),
  }
}

function listSessionsDb(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const orderBy = vi.fn(() => ({ limit }))
  const groupBy = vi.fn(() => ({ orderBy }))
  const where = vi.fn(() => ({ groupBy }))
  const leftJoin = vi.fn(() => ({ where }))
  const from = vi.fn(() => ({ leftJoin }))
  const select = vi.fn(() => ({ from }))
  const withFn = vi.fn(() => ({ select }))
  const $with = vi.fn(() => ({ as: vi.fn((q: unknown) => q) }))

  getDbMock.mockReturnValue({
    $with,
    with: withFn,
    select: vi.fn(() => cteSelectChain()),
  })

  return { withFn, select, limit }
}

function insertSessionDb(session: { id: string; title: string | null }) {
  const returning = vi.fn(async () => [session])
  const values = vi.fn(() => ({ returning }))
  const insert = vi.fn(() => ({ values }))
  getDbMock.mockReturnValue({ insert })
  return { insert, values }
}

describe('GET /api/chat/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(GET(event(null))).rejects.toMatchObject({ status: 401 })
  })

  it('lists sessions with computed titles from first message preview', async () => {
    listSessionsDb([
      {
        id: 's1',
        title: '  ',
        mode: 'default',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        messageCount: 2,
        firstMessagePreview: 'Short preview',
      },
      {
        id: 's2',
        title: 'Saved title',
        mode: 'default',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        messageCount: 1,
        firstMessagePreview: 'ignored because title exists',
      },
      {
        id: 's3',
        title: null,
        mode: 'default',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-04T00:00:00.000Z',
        messageCount: 1,
        firstMessagePreview: 'A'.repeat(60),
      },
    ])

    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sessions: Array<{ id: string; title: string; messageCount: number }>
    }
    expect(body.sessions).toHaveLength(3)
    expect(body.sessions[0]).toMatchObject({ id: 's1', title: 'Short preview', messageCount: 2 })
    expect(body.sessions[1]).toMatchObject({ id: 's2', title: 'Saved title' })
    expect(body.sessions[2]?.title).toBe(`${'A'.repeat(47)}...`)
  })

  it('uses empty title when neither title nor preview exists', async () => {
    listSessionsDb([
      {
        id: 's-empty',
        title: null,
        mode: 'default',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 0,
        firstMessagePreview: null,
      },
    ])

    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sessions[0]).toMatchObject({ id: 's-empty', title: '' })
  })
})

describe('POST /api/chat/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    await expect(POST(event(null))).rejects.toMatchObject({ status: 401 })
  })

  it('creates a session for the authenticated user', async () => {
    const { values } = insertSessionDb({ id: 'sess-new', title: null })

    const res = await POST(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(values).toHaveBeenCalledWith({ userId: 'u1' })
    expect(await res.json()).toEqual({ session: { id: 'sess-new', title: null } })
  })
})
