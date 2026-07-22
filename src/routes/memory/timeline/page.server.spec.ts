import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  getUserPreferredTimezoneMock,
  listTemporalEventsForUserMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(async () => 'UTC'),
  listTemporalEventsForUserMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: getUserPreferredTimezoneMock,
}))
vi.mock('$lib/server/memory/temporal-event-list', () => ({
  listTemporalEventsForUser: listTemporalEventsForUserMock,
}))

import { load } from './+page.server'

function makePrefChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  }
  return chain
}

describe('memory/timeline page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: vi.fn(() => makePrefChain([])),
    })
    listTemporalEventsForUserMock.mockResolvedValue({ items: [], nextCursor: null })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(
      load({
        locals: { user: null },
        depends: vi.fn(),
      } as never),
    ).rejects.toMatchObject({ status: 302 })
  })

  it('returns prefetch shape with empty events without throwing', async () => {
    const result = await load({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      depends: vi.fn(),
    } as never)

    expect(result.prefetchedTemporalEvents).toEqual([])
    expect(result.prefetchedNextCursor).toBeNull()
    expect(result.preferredTimezone).toBe('UTC')
    expect(result.eventNotificationsEnabled).toBe(false)
    expect(result.eventReminderLeadMinutes).toBe(10)
    expect(listTemporalEventsForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        status: 'all',
        includeTasks: true,
        author: 'user',
        from: null,
        to: null,
        includeUndated: true,
      }),
    )
  })

  it('returns prefetched temporal events from the list helper', async () => {
    const item = { id: 'ev-1', semanticSummary: 'Dentist' }
    listTemporalEventsForUserMock.mockResolvedValueOnce({
      items: [item],
      nextCursor: { startAt: '2026-07-22T00:00:00.000Z', id: 'ev-1' },
    })
    getDbMock.mockReturnValue({
      select: vi.fn(() =>
        makePrefChain([
          { eventNotificationsEnabled: true, eventReminderLeadMinutes: 15 },
        ]),
      ),
    })

    const result = await load({
      locals: { user: { id: 'u1' } },
      depends: vi.fn(),
    } as never)

    expect(result.prefetchedTemporalEvents).toEqual([item])
    expect(result.prefetchedNextCursor).toEqual({
      startAt: '2026-07-22T00:00:00.000Z',
      id: 'ev-1',
    })
    expect(result.eventNotificationsEnabled).toBe(true)
    expect(result.eventReminderLeadMinutes).toBe(15)
  })
})
