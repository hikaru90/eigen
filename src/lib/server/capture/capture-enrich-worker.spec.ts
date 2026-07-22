import { beforeEach, describe, expect, it, vi } from 'vitest'

const { shouldScheduleMock, withDbUserMock, drainMock, syncMock } = vi.hoisted(() => ({
  shouldScheduleMock: vi.fn(),
  withDbUserMock: vi.fn(),
  drainMock: vi.fn(),
  syncMock: vi.fn(),
}))

vi.mock('$lib/server/auth/harness-account', () => ({
  shouldScheduleDevCaptureEnrichWorker: shouldScheduleMock,
}))

vi.mock('$lib/server/db', () => ({
  withDbUser: withDbUserMock,
}))

vi.mock('$lib/server/capture/enrich-queue-drain', () => ({
  drainCaptureEnrichQueue: drainMock,
}))

vi.mock('$lib/server/capture/sync-capture-enrich-queue', () => ({
  syncCaptureEnrichQueue: syncMock,
}))

describe('capture-enrich-worker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    shouldScheduleMock.mockResolvedValue(true)
    withDbUserMock.mockImplementation(async (_id: string, fn: () => Promise<void>) => {
      await fn()
    })
    syncMock.mockResolvedValue(undefined)
    drainMock.mockResolvedValue(undefined)
  })

  it('schedules sync+drain once per user and tracks active state', async () => {
    const mod = await import('./capture-enrich-worker')
    expect(mod.isCaptureEnrichWorkerActive('u1')).toBe(false)
    mod.scheduleCaptureEnrichWorker('u1')
    expect(mod.isCaptureEnrichWorkerActive('u1')).toBe(true)
    mod.scheduleCaptureEnrichWorker('u1')
    await mod.awaitCaptureEnrichWorkerIdle('u1')
    expect(shouldScheduleMock).toHaveBeenCalledTimes(1)
    expect(syncMock).toHaveBeenCalledWith('u1')
    expect(drainMock).toHaveBeenCalledWith('u1')
    expect(mod.isCaptureEnrichWorkerActive('u1')).toBe(false)
  })

  it('skips work when harness account is not allowed', async () => {
    shouldScheduleMock.mockResolvedValue(false)
    const mod = await import('./capture-enrich-worker')
    mod.scheduleCaptureEnrichWorker('u1')
    await mod.awaitCaptureEnrichWorkerIdle('u1')
    expect(withDbUserMock).not.toHaveBeenCalled()
  })

  it('logs worker failures', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    shouldScheduleMock.mockRejectedValue(new Error('boom'))
    const mod = await import('./capture-enrich-worker')
    mod.scheduleCaptureEnrichWorker('u1')
    await mod.awaitCaptureEnrichWorkerIdle('u1')
    expect(errSpy).toHaveBeenCalledWith(
      '[capture-enrich-worker] worker failed',
      expect.objectContaining({ userId: 'u1', message: 'boom' }),
    )
    errSpy.mockRestore()
  })
})
