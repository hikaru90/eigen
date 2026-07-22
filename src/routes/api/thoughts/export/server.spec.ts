import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GET } from './+server'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

function makeDbWithRows(rows: unknown[]) {
  const orderBy = vi.fn(async () => rows)
  const where = vi.fn(() => ({ orderBy }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  getDbMock.mockReturnValue({ select })
}

beforeEach(() => {
  getDbMock.mockReset()
})

describe('GET /api/thoughts/export', () => {
  it('returns 401 for unauthenticated requests', async () => {
    await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({
      status: 401,
    })
  })

  it('returns CSV with header and escaped data rows', async () => {
    const createdAt = new Date('2026-05-26T10:00:00.000Z')
    const updatedAt = new Date('2026-05-26T11:00:00.000Z')
    makeDbWithRows([
      {
        id: 't1',
        createdAt,
        updatedAt,
        category: 'task',
        rawText: 'Hello, "world"',
        normalizedText: 'Hello, world',
        metadata: { status: 'open' },
      },
    ])

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="thoughts-export-\d{4}-\d{2}-\d{2}\.csv"$/,
    )

    const csv = await res.text()
    const lines = csv.trimEnd().split('\n')
    expect(lines[0]).toBe('id,created_at,updated_at,category,raw_text,normalized_text,status')
    expect(lines[1]).toBe(
      't1,2026-05-26T10:00:00.000Z,2026-05-26T11:00:00.000Z,task,"Hello, ""world""","Hello, world",open',
    )
  })

  it('returns header-only CSV when user has no thoughts', async () => {
    makeDbWithRows([])

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)
    expect(res.status).toBe(200)

    const csv = await res.text()
    expect(csv.trimEnd()).toBe('id,created_at,updated_at,category,raw_text,normalized_text,status')
  })

  it('leaves status empty when metadata.status is missing', async () => {
    const createdAt = new Date('2026-05-26T10:00:00.000Z')
    const updatedAt = new Date('2026-05-26T10:00:00.000Z')
    makeDbWithRows([
      {
        id: 't2',
        createdAt,
        updatedAt,
        category: 'idea',
        rawText: 'plain',
        normalizedText: 'plain',
        metadata: {},
      },
    ])

    const res = await GET({ locals: { user: { id: 'u1' } } } as never)
    const lines = (await res.text()).trimEnd().split('\n')
    expect(lines[1]).toBe('t2,2026-05-26T10:00:00.000Z,2026-05-26T10:00:00.000Z,idea,plain,plain,')
  })
})
