import { beforeEach, describe, expect, it, vi } from 'vitest'

const { recoverMock, ensureMock, drainMock, snapshotMock } = vi.hoisted(() => ({
  recoverMock: vi.fn(),
  ensureMock: vi.fn(),
  drainMock: vi.fn(),
  snapshotMock: vi.fn(),
}))

vi.mock('./ensure-overnight', () => ({
  ensureOvernightJobsEnqueued: ensureMock,
}))
vi.mock('./drain', () => ({
  drainUserJobQueue: drainMock,
}))
vi.mock('./snapshot', () => ({
  loadJobQueueSnapshot: snapshotMock,
}))
vi.mock('./recover-stale-running', () => ({
  recoverStaleRunningJobs: recoverMock,
}))

describe('tickGlobalJobQueue', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    recoverMock.mockResolvedValue(0)
    ensureMock.mockResolvedValue(0)
    drainMock.mockResolvedValue({ claimed: 0, completed: 0, failed: 0 })
    snapshotMock.mockResolvedValue({
      pendingDue: 0,
      pendingFuture: 0,
      running: 0,
      failed: 0,
      oldestDuePendingAgeSec: null,
    })
  })

  it('clears ticking after a tick timeout so the next interval can run', async () => {
    let hangDrain = true
    drainMock.mockImplementation(() => {
      if (hangDrain) {
        return new Promise(() => {
          /* never resolves */
        })
      }
      return Promise.resolve({ claimed: 0, completed: 0, failed: 0 })
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { tickGlobalJobQueue } = await import('./tick')

    await expect(tickGlobalJobQueue(50)).rejects.toThrow(/job-queue tick timeout/)
    hangDrain = false
    await expect(tickGlobalJobQueue(50)).resolves.toEqual({
      enqueued: 0,
      drain: { claimed: 0, completed: 0, failed: 0 },
    })

    expect(warnSpy).not.toHaveBeenCalledWith(
      '[job-queue] tick skipped — previous tick still running',
    )
    warnSpy.mockRestore()
  })
})
