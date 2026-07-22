import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { listExternalBusyBlocksMock } = vi.hoisted(() => ({
  listExternalBusyBlocksMock: vi.fn(),
}))

vi.mock('$lib/server/calendar/external-calendar', () => ({
  listExternalBusyBlocks: listExternalBusyBlocksMock,
}))

function event(overrides: { user?: { id: string } | null; search?: string } = {}) {
  return {
    locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
    url: new URL(`http://localhost/api/timeline/calendar-overlay${overrides.search ?? ''}`),
  } as Parameters<typeof GET>[0]
}

describe('GET /api/timeline/calendar-overlay', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(GET(event({ user: null }))).rejects.toMatchObject({ status: 401 })
  })

  it('returns 400 when range params are missing', async () => {
    await expect(GET(event())).rejects.toMatchObject({ status: 400 })
  })

  it('returns 400 when range params are invalid dates', async () => {
    await expect(
      GET(event({ search: '?rangeStart=not-a-date&rangeEnd=also-not-a-date' })),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns external busy blocks for a valid range', async () => {
    listExternalBusyBlocksMock.mockResolvedValue([{ start: '2026-06-01', end: '2026-06-02' }])
    const res = await GET(
      event({ search: '?rangeStart=2026-06-01T00:00:00.000Z&rangeEnd=2026-06-08T00:00:00.000Z' }),
    )
    expect(listExternalBusyBlocksMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      blocks: [{ start: '2026-06-01', end: '2026-06-02' }],
      synced: false,
    })
  })
})
