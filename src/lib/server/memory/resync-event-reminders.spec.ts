import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resyncAllReminderSchedulesForUser } from './resync-event-reminders'

const { getDbMock, syncMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  syncMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/memory/event-reminder-schedule', () => ({
  syncReminderScheduleForEvent: syncMock,
}))

describe('resyncAllReminderSchedulesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    syncMock.mockResolvedValue(undefined)
  })

  it('syncs each open scheduled event and returns count', async () => {
    const rows = [
      {
        id: 'e1',
        kind: 'event',
        startAt: new Date('2026-01-01T10:00:00.000Z'),
        lifecycleStatus: 'open',
      },
      {
        id: 'e2',
        kind: 'deadline',
        startAt: new Date('2026-01-02T10:00:00.000Z'),
        lifecycleStatus: 'open',
      },
    ]
    const where = vi.fn(async () => rows)
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })

    await expect(resyncAllReminderSchedulesForUser('u1')).resolves.toBe(2)
    expect(syncMock).toHaveBeenCalledTimes(2)
    expect(syncMock).toHaveBeenCalledWith({
      userId: 'u1',
      temporalEventId: 'e1',
      kind: 'event',
      startAt: rows[0].startAt,
      lifecycleStatus: 'open',
    })
  })

  it('returns 0 when no open events', async () => {
    const where = vi.fn(async () => [])
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    getDbMock.mockReturnValue({ select })
    await expect(resyncAllReminderSchedulesForUser('u1')).resolves.toBe(0)
    expect(syncMock).not.toHaveBeenCalled()
  })
})
