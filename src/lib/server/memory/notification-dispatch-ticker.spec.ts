import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { tickMock } = vi.hoisted(() => ({
  tickMock: vi.fn(),
}))

vi.mock('$lib/server/memory/notification-dispatch-tick', () => ({
  tickNotificationDispatch: tickMock,
}))

vi.mock('$app/environment', () => ({
  building: false,
}))

describe('startNotificationDispatchTicker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    tickMock.mockResolvedValue({
      eventReminders: { sent: 0, failed: 0 },
      dailySummaries: { sent: 0, failed: 0 },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts once, runs immediately, and schedules interval', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { startNotificationDispatchTicker, NOTIFICATION_DISPATCH_TICK_MS } =
      await import('./notification-dispatch-ticker')
    startNotificationDispatchTicker()
    startNotificationDispatchTicker()
    await Promise.resolve()
    expect(tickMock).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledWith(
      '[notification-dispatch] in-process ticker started',
      expect.objectContaining({ intervalMs: NOTIFICATION_DISPATCH_TICK_MS }),
    )
    await vi.advanceTimersByTimeAsync(NOTIFICATION_DISPATCH_TICK_MS)
    expect(tickMock).toHaveBeenCalledTimes(2)
    infoSpy.mockRestore()
  })

  it('logs tick failures', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    tickMock.mockRejectedValue(new Error('tick boom'))
    const { startNotificationDispatchTicker } = await import('./notification-dispatch-ticker')
    startNotificationDispatchTicker()
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled())
    expect(errSpy).toHaveBeenCalledWith(
      '[notification-dispatch] tick failed',
      expect.objectContaining({ message: 'tick boom' }),
    )
    errSpy.mockRestore()
  })
})
