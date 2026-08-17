import { describe, expect, it } from 'vitest'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import {
  completedTodayCount,
  countCompletedOnLocalDay,
  filterCompletedTodayItems,
  isCompletedOnLocalDay,
  isCompletedToday,
  previousLocalDayKey,
} from './timeline-completed-today'

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
  return {
    id: '1',
    itemType: 'event',
    kind: 'appointment',
    semanticSummary: 'Test',
    sourceTextSpan: null,
    timePrecision: 'day',
    timezone: 'UTC',
    isAllDay: true,
    confidence: 1,
    startAt: '2026-06-16T10:00:00.000Z',
    endAt: '2026-06-16T11:00:00.000Z',
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
    durationMinutes: null,
    energyLevel: null,
    priorityQuadrant: null,
    contextTags: [],
    focusRank: null,
    parentEventId: null,
    projectLabel: null,
    completedAt: null,
    lifecycleUpdatedAt: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('timeline-completed-today', () => {
  const now = new Date('2026-06-16T15:00:00.000Z')
  const tz = 'UTC'

  it('counts event completed today via lifecycleUpdatedAt', () => {
    const completed = item({
      lifecycleStatus: 'completed',
      lifecycleUpdatedAt: '2026-06-16T09:00:00.000Z',
    })
    expect(isCompletedToday(completed, tz, now)).toBe(true)
  })

  it('counts open loop completed today via completedAt metadata', () => {
    const completed = item({
      itemType: 'task',
      id: 'task:t1',
      thoughtStatus: 'completed',
      lifecycleStatus: 'completed',
      completedAt: '2026-06-16T08:30:00.000Z',
      startAt: null,
      endAt: null,
    })
    expect(isCompletedToday(completed, tz, now)).toBe(true)
  })

  it('excludes items completed on a prior day', () => {
    const completed = item({
      lifecycleStatus: 'completed',
      lifecycleUpdatedAt: '2026-06-15T23:00:00.000Z',
    })
    expect(isCompletedToday(completed, tz, now)).toBe(false)
  })

  it('excludes open items even when scheduled today', () => {
    expect(isCompletedToday(item(), tz, now)).toBe(false)
  })

  it('aggregates completedTodayCount', () => {
    const items = [
      item({
        id: 'a',
        lifecycleStatus: 'completed',
        lifecycleUpdatedAt: '2026-06-16T09:00:00.000Z',
      }),
      item({ id: 'b', lifecycleStatus: 'open' }),
      item({
        id: 'c',
        thoughtStatus: 'completed',
        lifecycleStatus: 'completed',
        completedAt: '2026-06-16T10:00:00.000Z',
      }),
    ]
    expect(completedTodayCount(items, tz, now)).toBe(2)
    expect(filterCompletedTodayItems(items, tz, now).map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('counts completions on a specific local day', () => {
    const items = [
      item({
        id: 'yesterday',
        lifecycleStatus: 'completed',
        completedAt: '2026-06-15T22:00:00.000Z',
      }),
      item({
        id: 'today',
        lifecycleStatus: 'completed',
        completedAt: '2026-06-16T10:00:00.000Z',
      }),
      item({ id: 'open', lifecycleStatus: 'open' }),
    ]
    expect(isCompletedOnLocalDay(items[0]!, tz, '2026-06-15')).toBe(true)
    expect(countCompletedOnLocalDay(items, tz, '2026-06-15')).toBe(1)
    expect(countCompletedOnLocalDay(items, tz, '2026-06-16')).toBe(1)
  })

  it('derives previous local day key', () => {
    const now = new Date('2026-06-16T08:00:00.000Z')
    expect(previousLocalDayKey(now, 'UTC')).toBe('2026-06-15')
  })
})
