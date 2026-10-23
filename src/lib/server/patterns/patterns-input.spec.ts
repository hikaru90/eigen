import { describe, expect, it } from 'vitest'
import {
  PATTERNS_CATALOG_LIMIT,
  PATTERN_ROW_SUMMARY_MAX_LENGTH,
  buildPatternsLlmInput,
  isoDay,
  type PatternThoughtRow,
} from './patterns-input'

const TODAY = new Date('2026-10-20T12:00:00.000Z')

function row(overrides: Partial<PatternThoughtRow> & { id: string }): PatternThoughtRow {
  return {
    category: 'idea',
    createdAt: new Date('2026-10-19T10:00:00.000Z'),
    communityIds: [],
    summary: 'A captured thought',
    ...overrides,
  }
}

const OVERLAYS = [
  { id: 'c1', name: 'Atlas threads' },
  { id: 'c2', name: 'Kiln questions' },
]

function baseRows(): PatternThoughtRow[] {
  return [
    row({ id: 't-1', category: 'todo', createdAt: new Date('2026-10-19T10:00:00.000Z'), communityIds: ['c1'], summary: 'Ship the Atlas export' }),
    row({ id: 't-2', category: 'idea', createdAt: new Date('2026-10-19T09:00:00.000Z'), summary: 'Try smaller weights' }),
    row({ id: 't-3', category: 'question', createdAt: new Date('2026-10-02T08:00:00.000Z'), communityIds: ['c2'], summary: 'Why does the kiln crack?' }),
    row({ id: 't-4', category: 'idea', createdAt: new Date('2026-09-10T08:00:00.000Z'), summary: 'Row outside the window' }),
    row({ id: 't-5', category: 'todo', createdAt: new Date('2026-10-19T11:00:00.000Z'), communityIds: ['c1'], summary: null }),
  ]
}

describe('isoDay', () => {
  it('formats a timestamp as its UTC calendar day, never the local day', () => {
    expect(isoDay(new Date('2026-10-19T23:30:00.000Z'))).toBe('2026-10-19')
    expect(isoDay(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01')
  })
})

describe('buildPatternsLlmInput', () => {
  it('counts thoughts per UTC day inside the window only, sorted ascending, non-zero days only', () => {
    const input = buildPatternsLlmInput({
      rows: baseRows(),
      overlays: OVERLAYS,
      threadActivity: [],
      today: TODAY,
    })
    expect(input.thoughtsPerDay).toEqual([
      { date: '2026-10-02', count: 1 },
      { date: '2026-10-19', count: 3 },
    ])
    expect(input.totalThoughts).toBe(4)
  })

  it('exposes the window bounds it computed', () => {
    const input = buildPatternsLlmInput({
      rows: [],
      overlays: [],
      threadActivity: [],
      today: TODAY,
    })
    expect(input.window.days).toBe(21)
    expect(input.window.endDate).toBe('2026-10-20')
    expect(input.window.startDate).toBe('2026-09-30')
  })

  it('builds the category mix sorted by count desc then category asc', () => {
    const input = buildPatternsLlmInput({
      rows: baseRows(),
      overlays: OVERLAYS,
      threadActivity: [],
      today: TODAY,
    })
    expect(input.categoryMix).toEqual([
      { category: 'todo', count: 2 },
      { category: 'idea', count: 1 },
      { category: 'question', count: 1 },
    ])
  })

  it('maps community ids to overlay names and counts recent thoughts per community', () => {
    const input = buildPatternsLlmInput({
      rows: baseRows(),
      overlays: OVERLAYS,
      threadActivity: [],
      today: TODAY,
    })
    expect(input.communityActivity).toEqual([
      { name: 'Atlas threads', recentThoughtCount: 2 },
      { name: 'Kiln questions', recentThoughtCount: 1 },
    ])
  })

  it('ignores community ids without an overlay name instead of inventing labels', () => {
    const rows = [row({ id: 't-1', communityIds: ['c-ghost'] })]
    const input = buildPatternsLlmInput({ rows, overlays: [], threadActivity: [], today: TODAY })
    expect(input.communityActivity).toEqual([])
  })

  it('sorts thread activity by count desc then label asc and caps it', () => {
    const threadActivity = [
      { label: 'B thread', recentThoughtCount: 1 },
      { label: 'A thread', recentThoughtCount: 3 },
      { label: 'C thread', recentThoughtCount: 1 },
    ]
    const input = buildPatternsLlmInput({
      rows: baseRows(),
      overlays: OVERLAYS,
      threadActivity,
      today: TODAY,
    })
    expect(input.threadActivity).toEqual([
      { label: 'A thread', recentThoughtCount: 3 },
      { label: 'B thread', recentThoughtCount: 1 },
      { label: 'C thread', recentThoughtCount: 1 },
    ])
  })

  it('builds the thought catalog from rows with summaries, newest first, ids the judge may cite', () => {
    const input = buildPatternsLlmInput({
      rows: baseRows(),
      overlays: OVERLAYS,
      threadActivity: [],
      today: TODAY,
    })
    expect(input.thoughtCatalog.map((entry) => entry.id)).toEqual(['t-1', 't-2', 't-3'])
    expect(input.thoughtCatalog[0]).toEqual({
      id: 't-1',
      day: '2026-10-19',
      category: 'todo',
      communities: ['Atlas threads'],
      summary: 'Ship the Atlas export',
    })
    expect(input.thoughtCatalog[1].communities).toEqual([])
  })

  it('clamps catalog summaries to the row summary maximum', () => {
    const long = 'a'.repeat(PATTERN_ROW_SUMMARY_MAX_LENGTH + 40)
    const input = buildPatternsLlmInput({
      rows: [row({ id: 't-1', summary: long })],
      overlays: [],
      threadActivity: [],
      today: TODAY,
    })
    expect(input.thoughtCatalog[0].summary.length).toBe(PATTERN_ROW_SUMMARY_MAX_LENGTH)
  })

  it('caps the catalog at PATTERNS_CATALOG_LIMIT by default and at an explicit smaller limit', () => {
    const many = Array.from({ length: PATTERNS_CATALOG_LIMIT + 10 }, (_, i) =>
      row({ id: `t-${i}`, createdAt: new Date(Date.UTC(2026, 9, 20, 0, i)) }),
    )
    const capped = buildPatternsLlmInput({ rows: many, overlays: [], threadActivity: [], today: TODAY })
    expect(capped.thoughtCatalog.length).toBe(PATTERNS_CATALOG_LIMIT)
    // 70 rows (t-0…t-69), newest minute last → the newest id leads the capped catalog.
    expect(capped.thoughtCatalog[0].id).toBe('t-69')

    const tiny = buildPatternsLlmInput({
      rows: many,
      overlays: [],
      threadActivity: [],
      today: TODAY,
      catalogLimit: 2,
    })
    expect(tiny.thoughtCatalog.map((entry) => entry.id)).toEqual(['t-69', 't-68'])
  })

  it('respects a custom window when given', () => {
    const input = buildPatternsLlmInput({
      rows: baseRows(),
      overlays: [],
      threadActivity: [],
      today: TODAY,
      windowDays: 7,
    })
    expect(input.window.days).toBe(7)
    expect(input.window.startDate).toBe('2026-10-14')
    // t-1, t-2 and the summary-less t-5 all sit on 2026-10-19; t-3 (10-02) falls out.
    expect(input.totalThoughts).toBe(3)
  })

  it('is deterministic for identical fixtures', () => {
    const a = buildPatternsLlmInput({ rows: baseRows(), overlays: OVERLAYS, threadActivity: [], today: TODAY })
    const b = buildPatternsLlmInput({ rows: baseRows(), overlays: OVERLAYS, threadActivity: [], today: TODAY })
    expect(a).toEqual(b)
  })
})
