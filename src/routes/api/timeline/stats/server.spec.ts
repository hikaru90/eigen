import { describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { computeTimelineStatsForUserMock } = vi.hoisted(() => ({
  computeTimelineStatsForUserMock: vi.fn(),
}))

vi.mock('$lib/server/memory/timeline-stats', () => ({
  computeTimelineStatsForUser: computeTimelineStatsForUserMock,
}))

function event(user: { id: string } | null = { id: 'u1' }, search = '') {
  return {
    locals: { user },
    url: new URL(`http://localhost/api/timeline/stats${search}`),
  } as Parameters<typeof GET>[0]
}

describe('GET /api/timeline/stats', () => {
  it('returns 401 when unauthenticated', async () => {
    await expect(GET(event(null))).rejects.toMatchObject({ status: 401 })
  })

  it('returns timeline stats for the user', async () => {
    computeTimelineStatsForUserMock.mockResolvedValue({ openTasks: 3, overdue: 1 })
    const res = await GET(event())
    expect(computeTimelineStatsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ openTasks: 3, overdue: 1 })
  })

  it('forwards from/to/includeUndated to stats computation', async () => {
    computeTimelineStatsForUserMock.mockResolvedValue({
      todoTodayCount: 1,
      doneTodayCount: 0,
      overdueCount: 0,
    })
    const res = await GET(
      event(
        { id: 'u1' },
        '?from=2026-07-14T00:00:00.000Z&to=2026-07-20T23:59:59.999Z&includeUndated=true',
      ),
    )
    expect(res.status).toBe(200)
    expect(computeTimelineStatsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        from: '2026-07-14T00:00:00.000Z',
        to: '2026-07-20T23:59:59.999Z',
        includeUndated: true,
      }),
    )
  })

  it('omits author filter when author query param is absent', async () => {
    computeTimelineStatsForUserMock.mockResolvedValue({
      todoTodayCount: 0,
      doneTodayCount: 0,
      overdueCount: 0,
    })
    const res = await GET(event({ id: 'u1' }))
    expect(res.status).toBe(200)
    expect(computeTimelineStatsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ author: undefined }),
    )
  })
})
