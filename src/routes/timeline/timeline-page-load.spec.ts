import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, getUserPreferredTimezoneMock, loadUnifiedTimelineMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(async () => 'UTC'),
  loadUnifiedTimelineMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: getUserPreferredTimezoneMock,
}))
vi.mock('$lib/server/memory/timeline-unified', () => ({
  loadUnifiedTimeline: loadUnifiedTimelineMock,
}))

import { loadTimelinePageData } from './timeline-page-load'

function makePrefChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  }
  return chain
}

describe('loadTimelinePageData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDbMock.mockReturnValue({
      select: vi.fn(() => makePrefChain([])),
    })
    loadUnifiedTimelineMock.mockResolvedValue({ items: [], projects: [] })
  })

  it('redirects unauthenticated users to login', async () => {
    await expect(
      loadTimelinePageData({
        locals: { user: null },
        depends: vi.fn(),
      } as never),
    ).rejects.toMatchObject({ status: 302 })
  })

  it('returns prefetch shape with empty timeline without throwing', async () => {
    const result = await loadTimelinePageData({
      locals: { user: { id: 'u1', email: 'a@b.c' } },
      depends: vi.fn(),
    } as never)

    expect(result.prefetchedTimeline).toEqual({ items: [], projects: [] })
    expect(result.prefetchedAuthorScope).toBe('user')
    expect(result.preferredTimezone).toBe('UTC')
    expect(result.eventNotificationsEnabled).toBe(false)
    expect(result.eventReminderLeadMinutes).toBe(10)
    expect(loadUnifiedTimelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        author: 'user',
        from: null,
        to: null,
        includeUndated: true,
      }),
    )
  })

  it('returns prefetched timeline from the unified helper', async () => {
    const item = { id: 'ev-1', semanticSummary: 'Dentist' }
    const project = { entityId: 'p1', label: 'Alpha' }
    loadUnifiedTimelineMock.mockResolvedValueOnce({
      items: [item],
      projects: [project],
    })
    getDbMock.mockReturnValue({
      select: vi.fn(() =>
        makePrefChain([
          { eventNotificationsEnabled: true, eventReminderLeadMinutes: 15 },
        ]),
      ),
    })

    const result = await loadTimelinePageData({
      locals: { user: { id: 'u1' } },
      depends: vi.fn(),
    } as never)

    expect(result.prefetchedTimeline).toEqual({ items: [item], projects: [project] })
    expect(result.eventNotificationsEnabled).toBe(true)
    expect(result.eventReminderLeadMinutes).toBe(15)
  })
})
