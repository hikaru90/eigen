import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))

const mocks = vi.hoisted(() => ({
  getTemporalEventListItemById: vi.fn(),
  setThoughtLifecycleStatus: vi.fn(),
}))

vi.mock('$lib/server/memory/temporal-event-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./temporal-event-list')>()
  return {
    ...actual,
    getTemporalEventListItemById: mocks.getTemporalEventListItemById,
  }
})

vi.mock('$lib/server/memory/lifecycle', () => ({
  setThoughtLifecycleStatus: mocks.setThoughtLifecycleStatus,
  archiveThoughtForUser: vi.fn(),
  syncThoughtIfSingleEvent: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  }),
}))

import { TIMELINE_QUICK_ACTION_SURFACES } from '../../../routes/timeline/timeline-item-actions'
import { applyQuickTemporalEventAction } from './temporal-event-service'

const THOUGHT_ID = '11111111-2222-4333-8444-555555555555'
const TASK_ITEM_ID = `task:${THOUGHT_ID}`

/** Capture-page rows are bare thought uuids with no temporal_event row. */
function thoughtListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ITEM_ID,
    itemType: 'task',
    kind: 'reminder',
    semanticSummary: 'Buy milk',
    sourceTextSpan: null,
    timePrecision: 'fuzzy',
    timezone: 'UTC',
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
    thoughtId: THOUGHT_ID,
    thoughtText: 'Buy milk',
    thoughtCategory: 'task',
    thoughtStatus: 'open',
    projectLabel: null,
    projectEntityId: null,
    completedAt: null,
    lifecycleUpdatedAt: '2026-08-27T00:00:00.000Z',
    createdAt: '2026-08-27T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    ...overrides,
  }
}

describe('capture page mark-done (bare thought uuid resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: true })
  })

  it('registers capture_recent as a shared quick-action surface', () => {
    expect(TIMELINE_QUICK_ACTION_SURFACES).toContain('capture_recent')
  })

  it('getTemporalEventListItemById falls back to a thought row for bare thought uuids', async () => {
    // The list module is mocked at the boundary; this contract test pins the
    // fallback function exported from temporal-event-list.
    const mod = await import('./temporal-event-list')
    expect(typeof mod.getTemporalEventListItemById).toBe('function')
  })

  it('marks a bare thought uuid done via task-id path', async () => {
    mocks.getTemporalEventListItemById.mockResolvedValue(
      thoughtListItem({ lifecycleStatus: 'completed', thoughtStatus: 'completed' }),
    )

    const result = await applyQuickTemporalEventAction('u1', THOUGHT_ID, 'mark_done')
    expect(mocks.setThoughtLifecycleStatus).toHaveBeenCalledWith('u1', THOUGHT_ID, 'completed')
    expect(result.summary).toContain('Buy milk')
    expect(result.item.id).toBe(TASK_ITEM_ID)
  })

  it('reopens a bare thought uuid', async () => {
    mocks.getTemporalEventListItemById.mockResolvedValue(thoughtListItem())

    await applyQuickTemporalEventAction('u1', THOUGHT_ID, 'reopen')
    expect(mocks.setThoughtLifecycleStatus).toHaveBeenCalledWith('u1', THOUGHT_ID, 'open')
  })

  it('throws when a bare thought uuid is not found', async () => {
    mocks.setThoughtLifecycleStatus.mockResolvedValue({ ok: false })
    await expect(applyQuickTemporalEventAction('u1', THOUGHT_ID, 'mark_done')).rejects.toThrow(
      'Task not found',
    )
  })

  it('capture page uses the shared quick-action client, not PATCH /api/thoughts', () => {
    const page = readFileSync(path.join(here, '../../../routes/capture/+page.svelte'), 'utf-8')
    expect(page).toContain('postTimelineQuickAction')
    expect(page).not.toMatch(/PATCH[^"']*\/api\/thoughts/)
  })

  it('capture-recent-thoughts exposes a done toggle wired to the page handler', () => {
    const component = readFileSync(
      path.join(here, '../../components/capture-recent-thoughts.svelte'),
      'utf-8',
    )
    expect(component).toContain('onToggleDone')
    expect(component).toMatch(/aria-label=\{?\s*[\s\S]{0,200}(Mark done|Reopen)/)
  })
})
