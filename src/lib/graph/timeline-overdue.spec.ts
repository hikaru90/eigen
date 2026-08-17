import { describe, expect, it } from 'vitest'
import {
  bucketOverdueElapsed,
  filterOverdueItems,
  filterPriorDayOverdueItems,
  isOverdueItem,
  isPriorDayOverdue,
  isScheduledForToday,
  overdueCount,
  overdueElapsedMs,
} from '$lib/graph/timeline-overdue'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
  return {
    id: '1',
    itemType: 'event',
    kind: 'appointment',
    semanticSummary: 'Test',
    sourceTextSpan: null,
    timePrecision: 'day',
    timezone: 'UTC',
    isAllDay: false,
    confidence: 1,
    startAt: '2026-05-20T10:00:00.000Z',
    endAt: '2026-05-20T11:00:00.000Z',
    activePeriod: '',
    graphSyncStatus: 'synced',
    graphSyncError: null,
    thoughtId: 't1',
    thoughtText: 'thought',
    thoughtCategory: 'task',
    thoughtStatus: 'open',
    lifecycleStatus: 'open',
    snoozedUntil: null,
    recurrenceRule: null,
    durationMinutes: 30,
    energyLevel: null,
    priorityQuadrant: null,
    contextTags: [],
    focusRank: null,
    parentEventId: null,
    projectLabel: null,
    completedAt: null,
    lifecycleUpdatedAt: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('timeline overdue helpers', () => {
  const now = new Date('2026-06-08T12:00:00.000Z')

  it('flags items with past endAt as overdue', () => {
    const overdue = item({ id: 'a', endAt: '2026-06-07T12:00:00.000Z' })
    expect(isOverdueItem(overdue, now)).toBe(true)
    expect(filterOverdueItems([overdue], now).map((i) => i.id)).toEqual(['a'])
  })

  it('flags items with past startAt and no endAt as overdue', () => {
    const overdue = item({
      id: 'b',
      startAt: '2026-06-07T08:00:00.000Z',
      endAt: null,
    })
    expect(isOverdueItem(overdue, now)).toBe(true)
  })

  it('excludes completed and unscheduled open loops without dates', () => {
    const completed = item({
      id: 'c',
      lifecycleStatus: 'completed',
      endAt: '2026-06-07T12:00:00.000Z',
    })
    const taskItem = item({
      id: 'd',
      itemType: 'task',
      startAt: null,
      endAt: null,
    })
    expect(isOverdueItem(completed, now)).toBe(false)
    expect(isOverdueItem(taskItem, now)).toBe(false)
    expect(overdueCount([completed, taskItem], now)).toBe(0)
  })

  it('computes elapsed overdue duration buckets', () => {
    const overdue = item({ endAt: '2026-06-08T10:00:00.000Z' })
    const ms = overdueElapsedMs(overdue, now)
    expect(ms).toBe(2 * 60 * 60 * 1000)
    expect(bucketOverdueElapsed(ms!)).toEqual({ unit: 'hours', value: 2 })
  })

  it('treats overdue-today as today todo, not prior-day overdue', () => {
    const todayNow = new Date('2026-06-16T17:00:00.000Z')
    const overdueToday = item({
      startAt: '2026-06-16T08:00:00.000Z',
      endAt: '2026-06-16T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    expect(isScheduledForToday(overdueToday, 'Europe/Berlin', todayNow)).toBe(true)
    expect(isPriorDayOverdue(overdueToday, 'Europe/Berlin', todayNow)).toBe(false)
  })

  it('flags prior-day overdue separately from today overdue', () => {
    const todayNow = new Date('2026-06-16T17:00:00.000Z')
    const overdueYesterday = item({
      id: 'y',
      startAt: '2026-06-15T08:00:00.000Z',
      endAt: '2026-06-15T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    const overdueToday = item({
      id: 't',
      startAt: '2026-06-16T08:00:00.000Z',
      endAt: '2026-06-16T09:00:00.000Z',
      timezone: 'Europe/Berlin',
    })
    expect(
      filterPriorDayOverdueItems([overdueYesterday, overdueToday], 'Europe/Berlin', todayNow).map(
        (i) => i.id,
      ),
    ).toEqual(['y'])
  })
})
