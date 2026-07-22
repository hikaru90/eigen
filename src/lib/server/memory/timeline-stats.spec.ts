import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeStreakDaysFromCompletions, computeTimelineStatsForUser } from './timeline-stats'

const { getDbMock, listTemporalEventsForUserMock, getUserPreferredTimezoneMock } = vi.hoisted(
  () => ({
    getDbMock: vi.fn(),
    listTemporalEventsForUserMock: vi.fn(),
    getUserPreferredTimezoneMock: vi.fn(async () => 'UTC'),
  }),
)

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/memory/temporal-event-list', () => ({
  listTemporalEventsForUser: listTemporalEventsForUserMock,
}))

vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: getUserPreferredTimezoneMock,
}))

function makeAwaitableChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(rows).then(onFulfilled, onRejected)
    },
  }
  return chain
}

describe('computeTimelineStatsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes prior-day overdueCount from open overdue items', async () => {
    const now = Date.now()
    const priorDayOverdue = {
      id: '1',
      itemType: 'event',
      lifecycleStatus: 'open',
      thoughtStatus: 'open',
      timezone: 'UTC',
      endAt: new Date(now - 60_000).toISOString(),
      startAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    }
    const taskItem = {
      id: '2',
      itemType: 'task',
      lifecycleStatus: 'open',
      thoughtStatus: 'open',
      startAt: null,
      endAt: null,
    }

    getDbMock.mockReturnValue({
      select: vi.fn(() => makeAwaitableChain([])),
    })

    // Single list call with status=all; open items derived in-process
    listTemporalEventsForUserMock.mockResolvedValueOnce({
      items: [priorDayOverdue, taskItem],
    })

    const stats = await computeTimelineStatsForUser('u1')
    expect(stats.overdueCount).toBe(1)
    expect(stats.todoTodayCount).toBe(2)
    expect(listTemporalEventsForUserMock).toHaveBeenCalledTimes(1)
    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all' }),
    )
  })

  it('counts prior-day overdue in todoTodayCount when nothing is scheduled today', async () => {
    const now = Date.now()
    const priorDayOverdue = {
      id: '1',
      itemType: 'event',
      lifecycleStatus: 'open',
      thoughtStatus: 'open',
      timezone: 'UTC',
      endAt: new Date(now - 60_000).toISOString(),
      startAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
    }

    getDbMock.mockReturnValue({
      select: vi.fn(() => makeAwaitableChain([])),
    })

    listTemporalEventsForUserMock.mockResolvedValueOnce({ items: [priorDayOverdue] })

    const stats = await computeTimelineStatsForUser('u1')
    expect(stats.overdueCount).toBe(1)
    expect(stats.todoTodayCount).toBe(1)
    expect(listTemporalEventsForUserMock).toHaveBeenCalledTimes(1)
  })

  it('bounds DB round-trips: no per-day streak loop (≤4 selects)', async () => {
    const selectMock = vi.fn(() => makeAwaitableChain([]))
    getDbMock.mockReturnValue({ select: selectMock })
    listTemporalEventsForUserMock.mockResolvedValueOnce({ items: [] })

    await computeTimelineStatsForUser('u1')

    // Completions week (events + tasks) + streak window (events + tasks) = 4 max.
    // Must not be 2 + (30 * up to 2) per-day loops.
    expect(selectMock.mock.calls.length).toBeLessThanOrEqual(4)
    expect(selectMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('computes consecutive streak days from completion timestamps', () => {
    const now = new Date('2026-07-22T15:00:00.000Z')
    const day = (offset: number) => {
      const d = new Date(now)
      d.setDate(now.getDate() - offset)
      d.setHours(10, 0, 0, 0)
      return d
    }
    expect(computeStreakDaysFromCompletions([day(0), day(1), day(2)], now)).toBe(3)
    expect(computeStreakDaysFromCompletions([day(0), day(2)], now)).toBe(1)
    expect(computeStreakDaysFromCompletions([], now)).toBe(0)
  })
})
