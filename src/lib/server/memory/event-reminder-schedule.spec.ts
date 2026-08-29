import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeExplicitReminderDefaultFireAt,
  computeReminderFireAt,
  syncReminderScheduleForEvent,
} from './event-reminder-schedule'

const { prefsMock } = vi.hoisted(() => ({
  prefsMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => dbMock,
}))

vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserEventNotificationPrefs: prefsMock,
}))

const insertValues = vi.fn(() => ({
  onConflictDoUpdate: vi.fn(async () => undefined),
}))
const insert = vi.fn(() => ({ values: insertValues }))
const updateWhere = vi.fn(async () => undefined)
const updateSet = vi.fn(() => ({ where: updateWhere }))
const update = vi.fn(() => ({ set: updateSet }))
const dbMock = { insert, update }

function lastInsertedValues(): Record<string, unknown> {
  expect(insertValues).toHaveBeenCalled()
  return insertValues.mock.calls.at(-1)![0] as Record<string, unknown>
}

describe('computeReminderFireAt', () => {
  it('subtracts lead minutes from start', () => {
    const start = new Date('2026-06-10T15:00:00.000Z')
    const fire = computeReminderFireAt(start, 10)
    expect(fire.toISOString()).toBe('2026-06-10T14:50:00.000Z')
  })
})

describe('computeExplicitReminderDefaultFireAt', () => {
  it('returns next 09:00 in the given timezone (same day when still ahead)', () => {
    const fire = computeExplicitReminderDefaultFireAt('UTC', new Date('2026-06-10T07:00:00.000Z'))
    expect(fire.toISOString()).toBe('2026-06-10T09:00:00.000Z')
  })

  it('rolls to tomorrow 09:00 when 09:00 already passed', () => {
    const fire = computeExplicitReminderDefaultFireAt('UTC', new Date('2026-06-10T15:00:00.000Z'))
    expect(fire.toISOString()).toBe('2026-06-11T09:00:00.000Z')
  })

  it('honors non-UTC timezones', () => {
    // 15:00Z = 17:00 in Berlin (summer) → past 09:00 → next day 09:00 CEST = 07:00Z
    const fire = computeExplicitReminderDefaultFireAt(
      'Europe/Berlin',
      new Date('2026-06-10T15:00:00.000Z'),
    )
    expect(fire.toISOString()).toBe('2026-06-11T07:00:00.000Z')
  })
})

describe('syncReminderScheduleForEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prefsMock.mockResolvedValue({
      preferredTimezone: 'UTC',
      eventNotificationsEnabled: true,
      eventReminderLeadMinutes: 10,
    })
  })

  function input(overrides: Record<string, unknown> = {}) {
    return {
      userId: 'u1',
      temporalEventId: 'te1',
      kind: 'appointment',
      startAt: new Date('2030-01-01T10:00:00.000Z') as Date | null,
      lifecycleStatus: 'open' as const,
      ...overrides,
    }
  }

  it('schedules a future reminder normally', async () => {
    await syncReminderScheduleForEvent(input())
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        temporalEventId: 'te1',
        fireAt: new Date('2030-01-01T09:50:00.000Z'),
        status: 'pending',
      }),
    )
  })

  it('clamps a past fireAt for explicit reminders instead of cancelling', async () => {
    const before = Date.now()
    await syncReminderScheduleForEvent(
      input({ kind: 'reminder', startAt: new Date('2020-01-01T10:00:00.000Z') }),
    )
    const values = lastInsertedValues()
    const fireAt = values.fireAt as Date
    expect(fireAt.getTime()).toBeGreaterThanOrEqual(before + 60_000)
    expect(fireAt.getTime()).toBeLessThanOrEqual(Date.now() + 60_000 + 5_000)
    expect(updateSet).not.toHaveBeenCalled()
  })

  it('clamps past fireAt for non-reminder kinds while the event itself is still in the future', async () => {
    // start in 5 min with a 10 min lead → fireAt is in the past, event is not
    const startAt = new Date(Date.now() + 5 * 60_000)
    await syncReminderScheduleForEvent(input({ kind: 'deadline', startAt }))
    const values = lastInsertedValues()
    const fireAt = values.fireAt as Date
    expect(fireAt.getTime()).toBeGreaterThan(Date.now())
    expect(fireAt.getTime()).toBeLessThanOrEqual(Date.now() + 65_000)
  })

  it('cancels non-reminder kinds when startAt itself is past', async () => {
    await syncReminderScheduleForEvent(
      input({ kind: 'deadline', startAt: new Date('2020-01-01T10:00:00.000Z') }),
    )
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('cancels non-reminder kinds with null startAt', async () => {
    await syncReminderScheduleForEvent(input({ kind: 'appointment', startAt: null }))
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('schedules a default fire time for explicit reminders with null startAt', async () => {
    await syncReminderScheduleForEvent(input({ kind: 'reminder', startAt: null }))
    const values = lastInsertedValues()
    const fireAt = values.fireAt as Date
    expect(fireAt.getTime()).toBeGreaterThan(Date.now())
    // 09:00 in the user's timezone
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(fireAt)
    const prefsTz = 'UTC'
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: prefsTz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(fireAt)
    expect(local).toBe('09:00')
    void parts
  })

  it('bypasses the notification pref for explicit reminders', async () => {
    prefsMock.mockResolvedValue({
      preferredTimezone: 'UTC',
      eventNotificationsEnabled: false,
      eventReminderLeadMinutes: 10,
    })
    await syncReminderScheduleForEvent(input({ kind: 'reminder' }))
    expect(insertValues).toHaveBeenCalled()
  })

  it('still cancels non-reminder kinds when the notification pref is disabled', async () => {
    prefsMock.mockResolvedValue({
      preferredTimezone: 'UTC',
      eventNotificationsEnabled: false,
      eventReminderLeadMinutes: 10,
    })
    await syncReminderScheduleForEvent(input())
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it('cancels when lifecycle is not open', async () => {
    await syncReminderScheduleForEvent(input({ lifecycleStatus: 'completed' }))
    expect(insertValues).not.toHaveBeenCalled()
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })
})
