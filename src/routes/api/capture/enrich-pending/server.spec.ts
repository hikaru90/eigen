import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './+server'

const { syncAndScheduleCaptureEnrichQueueMock } = vi.hoisted(() => ({
  syncAndScheduleCaptureEnrichQueueMock: vi.fn(),
}))

vi.mock('$lib/server/capture/sync-capture-enrich-queue', () => ({
  syncAndScheduleCaptureEnrichQueue: syncAndScheduleCaptureEnrichQueueMock,
}))

describe('GET /api/capture/enrich-pending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncAndScheduleCaptureEnrichQueueMock.mockResolvedValue({
      finalizedEnriched: 0,
      recoveredStale: 0,
      requeuedInFlight: 0,
      requeuedOrphaned: 0,
      activeThoughtIds: [],
    })
  })

  it('requires auth', async () => {
    await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 401 })
  })

  it('returns pending thought ids', async () => {
    syncAndScheduleCaptureEnrichQueueMock.mockResolvedValue({
      finalizedEnriched: 0,
      recoveredStale: 0,
      requeuedInFlight: 0,
      requeuedOrphaned: 0,
      activeThoughtIds: ['t1', 't2'],
    })
    const res = await GET({ locals: { user: { id: 'u1' } } } as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ thoughtIds: ['t1', 't2'] })
    expect(syncAndScheduleCaptureEnrichQueueMock).toHaveBeenCalledWith('u1')
  })
})
