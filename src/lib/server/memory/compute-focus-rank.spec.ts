import { describe, expect, it } from 'vitest'
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list'
import { computeFocusRank, sortByFocusRank } from './compute-focus-rank'

const TZ = 'UTC'
const NOW = new Date('2026-06-15T12:00:00.000Z')

function makeItem(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
  return {
    id: 'e1',
    itemType: 'event',
    kind: 'appointment',
    semanticSummary: 'Test',
    sourceTextSpan: null,
    timePrecision: 'exact',
    timezone: TZ,
    isAllDay: false,
    confidence: 1,
    startAt: null,
    endAt: null,
    activePeriod: '',
    graphSyncStatus: 'n/a',
    graphSyncError: null,
    lifecycleStatus: 'open',
    snoozedUntil: null,
    recurrenceRule: null,
    durationMinutes: null,
    energyLevel: null,
    priorityQuadrant: null,
    contextTags: [],
    focusRank: null,
    parentEventId: null,
    thoughtId: 't1',
    thoughtText: 'Test',
    thoughtCategory: 'event',
    thoughtStatus: 'open',
    projectLabel: null,
    projectEntityId: null,
    completedAt: null,
    lifecycleUpdatedAt: null,
    createdAt: NOW.toISOString(),
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('computeFocusRank', () => {
  it('ranks tasks as fixed 600 regardless of other fields', () => {
    const task = makeItem({ itemType: 'task', kind: 'reminder' })
    expect(computeFocusRank(task, NOW, TZ)).toBe(600)
  })

  it('ranks events with no start date lowest within their section (900)', () => {
    const item = makeItem({ startAt: null, kind: 'reminder' })
    expect(computeFocusRank(item, NOW, TZ)).toBe(900)
  })

  it('ranks items scheduled today higher than tomorrow', () => {
    const today = makeItem({ startAt: '2026-06-15T18:00:00.000Z', kind: 'reminder' })
    const tomorrow = makeItem({ startAt: '2026-06-16T09:00:00.000Z', kind: 'reminder' })
    expect(computeFocusRank(today, NOW, TZ)).toBeLessThan(computeFocusRank(tomorrow, NOW, TZ))
  })

  it('ranks items within the week above items further out', () => {
    const withinWeek = makeItem({ startAt: '2026-06-19T09:00:00.000Z', kind: 'reminder' })
    const beyondWeek = makeItem({ startAt: '2026-07-01T09:00:00.000Z', kind: 'reminder' })
    expect(computeFocusRank(withinWeek, NOW, TZ)).toBeLessThan(
      computeFocusRank(beyondWeek, NOW, TZ),
    )
  })

  it('boosts deadlines and appointments relative to other kinds', () => {
    const deadline = makeItem({ startAt: '2026-06-15T18:00:00.000Z', kind: 'deadline' })
    const appointment = makeItem({ startAt: '2026-06-15T18:00:00.000Z', kind: 'appointment' })
    const milestone = makeItem({ startAt: '2026-06-15T18:00:00.000Z', kind: 'milestone' })
    expect(computeFocusRank(deadline, NOW, TZ)).toBeLessThan(computeFocusRank(milestone, NOW, TZ))
    expect(computeFocusRank(appointment, NOW, TZ)).toBeLessThan(
      computeFocusRank(milestone, NOW, TZ),
    )
    expect(computeFocusRank(deadline, NOW, TZ)).toBeLessThan(computeFocusRank(appointment, NOW, TZ))
  })

  it('clamps to a stored focusRank when it is lower than the computed rank', () => {
    const item = makeItem({
      startAt: '2026-07-01T09:00:00.000Z',
      kind: 'milestone',
      focusRank: 5,
    })
    expect(computeFocusRank(item, NOW, TZ)).toBe(5)
  })

  it('ignores a stored focusRank that is higher than the computed rank', () => {
    const item = makeItem({
      startAt: '2026-06-15T18:00:00.000Z',
      kind: 'reminder',
      focusRank: 999,
    })
    expect(computeFocusRank(item, NOW, TZ)).toBe(100)
  })

  it('penalizes items whose end time has already passed', () => {
    const overdue = makeItem({
      startAt: '2026-06-15T08:00:00.000Z',
      endAt: '2026-06-15T09:00:00.000Z',
      kind: 'reminder',
    })
    const notYetOver = makeItem({
      startAt: '2026-06-15T13:00:00.000Z',
      endAt: '2026-06-15T14:00:00.000Z',
      kind: 'reminder',
    })
    expect(computeFocusRank(overdue, NOW, TZ)).toBeLessThan(computeFocusRank(notYetOver, NOW, TZ))
  })
})

describe('sortByFocusRank', () => {
  it('sorts items ascending by computed focus rank', () => {
    const task = makeItem({ id: 'task', itemType: 'task', kind: 'reminder' })
    const today = makeItem({ id: 'today', startAt: '2026-06-15T18:00:00.000Z', kind: 'deadline' })
    const noDate = makeItem({ id: 'no-date', startAt: null, kind: 'reminder' })

    const sorted = sortByFocusRank([task, noDate, today], TZ, NOW)
    expect(sorted.map((i) => i.id)).toEqual(['today', 'task', 'no-date'])
  })

  it('defaults to the current time when now is omitted', () => {
    const item = makeItem({ startAt: null, kind: 'reminder' })
    expect(() => sortByFocusRank([item], TZ)).not.toThrow()
  })
})
