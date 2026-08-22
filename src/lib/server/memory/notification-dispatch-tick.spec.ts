import { beforeEach, describe, expect, it, vi } from 'vitest'

const { remindersMock, summariesMock } = vi.hoisted(() => ({
  remindersMock: vi.fn(),
  summariesMock: vi.fn(),
}))

vi.mock('$lib/server/memory/event-reminder-dispatch', () => ({
  dispatchDueEventReminders: remindersMock,
}))

vi.mock('$lib/server/memory/daily-summary-dispatch', () => ({
  dispatchDueDailySummaries: summariesMock,
}))

describe('tickNotificationDispatch', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    remindersMock.mockResolvedValue({ sent: 0, failed: 0 })
    summariesMock.mockResolvedValue({ sent: 0, failed: 0 })
  })

  it('runs both dispatchers and returns results', async () => {
    remindersMock.mockResolvedValue({ sent: 1, failed: 0 })
    summariesMock.mockResolvedValue({ sent: 0, failed: 1 })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { tickNotificationDispatch } = await import('./notification-dispatch-tick')
    const result = await tickNotificationDispatch()
    expect(result).toEqual({
      eventReminders: { sent: 1, failed: 0 },
      dailySummaries: { sent: 0, failed: 1 },
    })
    expect(infoSpy).toHaveBeenCalledWith(
      '[notification-dispatch] tick',
      expect.objectContaining({ eventReminders: { sent: 1, failed: 0 } }),
    )
    infoSpy.mockRestore()
  })

  it('clears ticking after a tick timeout so the next interval can run', async () => {
    remindersMock.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tickNotificationDispatch } = await import('./notification-dispatch-tick')

    await expect(tickNotificationDispatch(50)).rejects.toThrow(/notification-dispatch tick timeout/)

    remindersMock.mockResolvedValue({ sent: 0, failed: 0 })
    await expect(tickNotificationDispatch(50)).resolves.not.toBeNull()

    expect(warnSpy).not.toHaveBeenCalledWith(
      '[notification-dispatch] tick skipped — previous tick still running',
    )
    warnSpy.mockRestore()
  })

  it('skips overlapping ticks', async () => {
    let resolveReminders!: (v: { sent: number; failed: number }) => void
    remindersMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReminders = resolve
        }),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tickNotificationDispatch } = await import('./notification-dispatch-tick')
    const first = tickNotificationDispatch()
    const second = await tickNotificationDispatch()
    expect(second).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      '[notification-dispatch] tick skipped — previous tick still running',
    )
    resolveReminders({ sent: 0, failed: 0 })
    await first
    warnSpy.mockRestore()
  })
})
