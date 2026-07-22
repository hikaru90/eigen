import { describe, expect, it } from 'vitest'
import { computeReminderFireAt } from './event-reminder-schedule'

describe('computeReminderFireAt', () => {
  it('subtracts lead minutes from start', () => {
    const start = new Date('2026-06-10T15:00:00.000Z')
    const fire = computeReminderFireAt(start, 10)
    expect(fire.toISOString()).toBe('2026-06-10T14:50:00.000Z')
  })
})
