import type { TemporalEventListItem } from './temporal-event-list'
import { describe, expect, it } from 'vitest'
import { computeYesterdayStats, dailyDigestPush, type DailyDigest } from './daily-summary'
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

describe('computeYesterdayStats', () => {
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

    expect(computeYesterdayStats(openItems, allItems, 'UTC', now)).toEqual({
      completed: 2,
      overdue: 1,
      dueToday: 2,
    })
  })

  it('counts nothing overdue', () => {
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

    expect(computeYesterdayStats(openItems, allItems, 'UTC', now).overdue).toBe(0)
  })

  it('handles zero completions and zero due today', () => {
    expect(computeYesterdayStats([], [], 'UTC', now)).toEqual({ completed: 0, overdue: 0, dueToday: 0 })
  })
})

describe('dailyDigestPush', () => {
  const digest = (over: Partial<DailyDigest> = {}): DailyDigest => ({
    yesterday: { completed: 1, overdue: 0, dueToday: 2 },
    projects: [
      { entityId: 'p1', label: 'Eigenmesh', nextAction: 'Ship rewards' },
      { entityId: 'p2', label: 'Hydra buoy', nextAction: null },
    ],
    stalled: [{ entityId: 'p2', label: 'Hydra buoy', reason: 'no_next_action' }],
    unthreaded: { count: 3, recent: [] },
    agents: [
      { key: 'apikey:a', label: 'pi.dev', count: 6, recent: [] },
      { key: 'apikey:b', label: 'zai', count: 1, recent: [] },
    ],
    ...over,
  })

  it('leads with projects, open threads, loose tasks and agents; yesterday stays as information', () => {
    const push = dailyDigestPush(digest())
    expect(push.title).toBe('Daily summary')
    expect(push.url).toBe('/summary')
    expect(push.body).toBe(
      '2 active projects · 1 stalled · 3 tasks need a thread · Agents: pi.dev 6, zai 1. Yesterday: 1 task done, nothing overdue, 2 due today.',
    )
  })

  it('says so plainly when agents captured nothing', () => {
    const push = dailyDigestPush(digest({ agents: [], stalled: [], unthreaded: { count: 0, recent: [] } }))
    expect(push.body).toBe(
      '2 active projects · nothing stalled · every task has a thread · No agent captures. Yesterday: 1 task done, nothing overdue, 2 due today.',
    )
  })

  it('agrees in number', () => {
    const push = dailyDigestPush(
      digest({
        projects: [{ entityId: 'p1', label: 'One', nextAction: null }],
        unthreaded: { count: 1, recent: [] },
        yesterday: { completed: 0, overdue: 1, dueToday: 0 },
      }),
    )
    expect(push.body).toContain('1 active project ·')
    expect(push.body).toContain('1 task needs a thread')
    expect(push.body).toContain('Yesterday: no tasks done, 1 overdue, nothing due today.')
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
