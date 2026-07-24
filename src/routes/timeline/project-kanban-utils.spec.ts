import { describe, expect, it } from 'vitest'
import {
  groupProjectTasksByLifecycle,
  kanbanDropAction,
  kanbanEdgeScrollDelta,
  KANBAN_EDGE_SCROLL_MAX_PX,
  KANBAN_EDGE_SCROLL_ZONE_PX,
} from './project-kanban-utils'
import type { TemporalEventListItem } from '../api/temporal-events/+server'

function item(
  overrides: Partial<TemporalEventListItem> & Pick<TemporalEventListItem, 'id'>,
): TemporalEventListItem {
  return {
    itemType: 'task',
    kind: 'deadline',
    semanticSummary: overrides.semanticSummary ?? overrides.id,
    sourceTextSpan: null,
    timePrecision: 'day',
    timezone: 'UTC',
    isAllDay: true,
    confidence: 1,
    startAt: null,
    endAt: null,
    activePeriod: '',
    graphSyncStatus: 'synced',
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
    thoughtId: overrides.thoughtId ?? overrides.id,
    thoughtText: overrides.semanticSummary ?? overrides.id,
    thoughtCategory: 'task',
    thoughtStatus: 'open',
    memoryType: null,
    projectLabel: 'Launch',
    projectEntityId: 'p1',
    completedAt: null,
    lifecycleUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('groupProjectTasksByLifecycle', () => {
  it('groups by thoughtStatus into open, completed, archived', () => {
    const grouped = groupProjectTasksByLifecycle([
      item({ id: 'a', thoughtStatus: 'open', lifecycleStatus: 'open' }),
      item({
        id: 'b',
        thoughtStatus: 'completed',
        lifecycleStatus: 'completed',
        completedAt: '2026-02-01T00:00:00.000Z',
      }),
      item({ id: 'c', thoughtStatus: 'archived', lifecycleStatus: 'archived' }),
      item({ id: 'd', thoughtStatus: 'open', lifecycleStatus: 'open' }),
    ])

    expect(grouped.open.map((i) => i.id)).toEqual(['a', 'd'])
    expect(grouped.completed.map((i) => i.id)).toEqual(['b'])
    expect(grouped.archived.map((i) => i.id)).toEqual(['c'])
  })

  it('prefers thoughtStatus over lifecycleStatus when they differ', () => {
    const grouped = groupProjectTasksByLifecycle([
      item({ id: 'x', thoughtStatus: 'completed', lifecycleStatus: 'open' }),
    ])
    expect(grouped.completed.map((i) => i.id)).toEqual(['x'])
    expect(grouped.open).toHaveLength(0)
  })
})

describe('kanbanDropAction', () => {
  it('maps drop onto completed to mark_done when not already completed', () => {
    expect(kanbanDropAction('completed', 'open')).toBe('mark_done')
    expect(kanbanDropAction('completed', 'archived')).toBe('mark_done')
  })

  it('maps drop onto open to reopen when not already open', () => {
    expect(kanbanDropAction('open', 'completed')).toBe('reopen')
    expect(kanbanDropAction('open', 'archived')).toBe('reopen')
  })

  it('maps drop onto archived to archive when not already archived', () => {
    expect(kanbanDropAction('archived', 'open')).toBe('archive')
    expect(kanbanDropAction('archived', 'completed')).toBe('archive')
  })

  it('returns null when status already matches the target column (no-op)', () => {
    expect(kanbanDropAction('open', 'open')).toBeNull()
    expect(kanbanDropAction('completed', 'completed')).toBeNull()
    expect(kanbanDropAction('archived', 'archived')).toBeNull()
  })
})

describe('kanbanEdgeScrollDelta', () => {
  const left = 100
  const width = 300

  it('returns 0 when the pointer is in the middle of the board', () => {
    expect(kanbanEdgeScrollDelta(left + width / 2, left, width)).toBe(0)
  })

  it('scrolls left when the pointer is in the left edge zone', () => {
    const delta = kanbanEdgeScrollDelta(left + 4, left, width)
    expect(delta).toBeLessThan(0)
    expect(Math.abs(delta)).toBeLessThanOrEqual(KANBAN_EDGE_SCROLL_MAX_PX)
  })

  it('scrolls right when the pointer is in the right edge zone', () => {
    const delta = kanbanEdgeScrollDelta(left + width - 4, left, width)
    expect(delta).toBeGreaterThan(0)
    expect(delta).toBeLessThanOrEqual(KANBAN_EDGE_SCROLL_MAX_PX)
  })

  it('ramps speed toward the edge (closer = faster)', () => {
    const near = Math.abs(kanbanEdgeScrollDelta(left + 2, left, width))
    const farther = Math.abs(
      kanbanEdgeScrollDelta(left + KANBAN_EDGE_SCROLL_ZONE_PX - 2, left, width),
    )
    expect(near).toBeGreaterThan(farther)
  })

  it('returns 0 for zero-width containers', () => {
    expect(kanbanEdgeScrollDelta(150, left, 0)).toBe(0)
  })
})
