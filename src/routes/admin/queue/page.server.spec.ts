import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadAdminQueueDashboardMock } = vi.hoisted(() => ({
  loadAdminQueueDashboardMock: vi.fn(),
}))

vi.mock('$lib/server/job-queue/admin-dashboard', () => ({
  loadAdminQueueDashboard: loadAdminQueueDashboardMock,
}))

import { load } from './+page.server'

const emptyDashboard = {
  at: '2026-07-22T00:00:00.000Z',
  summary: {},
  ops: {},
  dailySummaries: [],
  jobs: [],
}

describe('admin/queue page server load', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAdminQueueDashboardMock.mockResolvedValue(emptyDashboard)
  })

  it('auth is enforced by admin layout requireAdmin, not this page load', async () => {
    // Page load itself has no session gate; layout.server does. Ensure page still returns when called.
    const result = await load({
      locals: { user: null },
      url: new URL('http://localhost/admin/queue'),
    } as never)

    expect(result.dashboard).toEqual(emptyDashboard)
    expect(result.status).toBe('all')
    expect(result.includeHarness).toBe(false)
  })

  it('returns empty dashboard shape without throwing', async () => {
    const result = await load({
      locals: { user: { id: 'admin1' } },
      url: new URL('http://localhost/admin/queue'),
    } as never)

    expect(result).toEqual({
      dashboard: emptyDashboard,
      status: 'all',
      includeHarness: false,
    })
    expect(loadAdminQueueDashboardMock).toHaveBeenCalledWith({
      status: 'all',
      includeHarness: false,
    })
  })

  it('parses status and harness query params', async () => {
    await load({
      locals: { user: { id: 'admin1' } },
      url: new URL('http://localhost/admin/queue?status=failed&harness=1'),
    } as never)

    expect(loadAdminQueueDashboardMock).toHaveBeenCalledWith({
      status: 'failed',
      includeHarness: true,
    })
  })
})
