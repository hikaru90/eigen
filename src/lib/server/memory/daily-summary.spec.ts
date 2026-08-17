import { describe, expect, it } from 'vitest'
import { buildDailySummaryPush } from './daily-summary'
import type { TemporalEventListItem } from './temporal-event-list'
import {
  formatMinutesLocal,
  isOpenTodoToday,
  parseTimeLocalToMinutes,
} from './timeline-today-server'

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
  return {
    id: '1',
    itemType: 'event',
    kind: 'appointment',
    semanticSummary: 'Standup',
    sourceTextSpan: null,
    timePrecision: 'minute',
    timezone: 'UTC',
    isAllDay: false,
    confidence: 1,
    startAt: '2026-06-08T10:00:00.000Z',
    endAt: '2026-06-08T11:00:00.000Z',
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
    createdAt: '2026-06-08T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('buildDailySummaryPush', () => {
  const now = new Date('2026-06-09T08:00:00.000Z')

  it('summarizes completed yesterday, overdue, and due today', () => {
    const openItems = [
      item({
        id: 'today',
        semanticSummary: 'Today task',
        startAt: '2026-06-09T10:00:00.000Z',
        endAt: '2026-06-09T11:00:00.000Z',
      }),
      item({
        id: 'overdue',
        semanticSummary: 'Overdue task',
        startAt: '2026-06-07T10:00:00.000Z',
        endAt: '2026-06-07T11:00:00.000Z',
      }),
      item({
        id: 'future',
        semanticSummary: 'Later task',
        startAt: '2026-06-10T10:00:00.000Z',
        endAt: '2026-06-10T11:00:00.000Z',
      }),
    ]
    const allItems = [
      ...openItems,
      item({
        id: 'done-yesterday',
        semanticSummary: 'Done yesterday',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        completedAt: '2026-06-08T15:00:00.000Z',
      }),
      item({
        id: 'done-yesterday-2',
        semanticSummary: 'Also done',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        completedAt: '2026-06-08T18:00:00.000Z',
      }),
    ]

    const push = buildDailySummaryPush(openItems, allItems, 'UTC', now)

    expect(push.title).toBe('Daily summary')
    expect(push.body).toContain('You completed 2 tasks yesterday.')
    expect(push.body).toContain('1 overdue task.')
    expect(push.body).toContain('2 due today.')
    expect(push.body).toContain('Tap to open your timeline.')
    expect(push.url).toBe('/memory/tasks?segment=overdue')
  })

  it('links to timeline when nothing is overdue', () => {
    const openItems = [
      item({
        id: 'today',
        semanticSummary: 'Today task',
        startAt: '2026-06-09T10:00:00.000Z',
        endAt: '2026-06-09T11:00:00.000Z',
      }),
    ]
    const allItems = [
      ...openItems,
      item({
        id: 'done-yesterday',
        lifecycleStatus: 'completed',
        thoughtStatus: 'completed',
        completedAt: '2026-06-08T12:00:00.000Z',
      }),
    ]

    const push = buildDailySummaryPush(openItems, allItems, 'UTC', now)

    expect(push.body).toContain('Nothing overdue.')
    expect(push.url).toBe('/memory/tasks')
  })

  it('handles zero completions and zero due today', () => {
    const push = buildDailySummaryPush([], [], 'UTC', now)

    expect(push.body).toContain('You did not finish any tasks yesterday.')
    expect(push.body).toContain('Nothing overdue.')
    expect(push.body).toContain('Nothing due today.')
  })
})

describe('timeline-today-server helpers', () => {
  it('parses HH:MM to minutes', () => {
    expect(parseTimeLocalToMinutes('08:30')).toBe(510)
    expect(formatMinutesLocal(510)).toBe('08:30')
  })

  it('detects open todos scheduled today', () => {
    const now = new Date('2026-06-08T12:00:00.000Z')
    expect(isOpenTodoToday(item(), now, 'UTC')).toBe(true)
    expect(
      isOpenTodoToday(
        item({ lifecycleStatus: 'completed', thoughtStatus: 'completed' }),
        now,
        'UTC',
      ),
    ).toBe(false)
  })
})
