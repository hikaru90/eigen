import { describe, expect, it } from 'vitest'
import {
  QUESTION_CATEGORY,
  agoLabel,
  askWhereItStandsHref,
  captureIntoHref,
  datedLabel,
  groupItemsByThread,
  openQuestionsOf,
  threadMeta,
  toThreadThought,
  uniqueThoughts,
} from './thread-list'

/**
 * Threads (ei redesign, wave 3.2): the pure parts of the projects list — ei
 * app.js:1042-1076 (`projectListHTML` / `projectDetailHTML`) and the `ago()` /
 * `shortDay()` helpers at app.js:53-66 — ported as timezone-aware functions
 * over the unified-timeline items that `/memory/projects` already loads
 * (TemporalEventListItem, src/lib/server/memory/temporal-event-list.ts:47-82).
 *
 * Grouping and formatting only. Which hub is a GTD project was decided
 * upstream (project_status set — listProjects, project-list.ts:243-249);
 * which thought is a question was decided by the LLM at capture (its
 * persisted category key). Nothing here decides meaning.
 */

// 2026-10-20 is a Tuesday. 14:00 in Europe/Berlin (UTC+2 until Oct 25, 2026).
const NOW_MS = Date.parse('2026-10-20T12:00:00Z')
const BERLIN = 'Europe/Berlin'
const fmt = { nowMs: NOW_MS, locale: 'en', timeZone: BERLIN }

type Item = {
  id: string
  thoughtId: string
  projectEntityId: string | null
  createdAt: string
  thoughtCategory: string
  thoughtStatus: 'open' | 'completed' | 'archived'
}

const item = (over: Partial<Item> & { thoughtId: string }): Item => ({
  id: `ev-${over.thoughtId}-${Math.random().toString(36).slice(2, 6)}`,
  projectEntityId: null,
  createdAt: '2026-10-20T09:00:00Z',
  thoughtCategory: 'task',
  thoughtStatus: 'open',
  ...over,
})

describe('groupItemsByThread', () => {
  it('splits items by their thread and keeps thoughts without one as loose ends', () => {
    const atlas1 = item({ thoughtId: 't1', projectEntityId: 'atlas' })
    const atlas2 = item({ thoughtId: 't2', projectEntityId: 'atlas' })
    const studio = item({ thoughtId: 't3', projectEntityId: 'studio' })
    const loose1 = item({ thoughtId: 't4', projectEntityId: null })
    const loose2 = item({ thoughtId: 't5', projectEntityId: null })

    const grouped = groupItemsByThread([atlas1, loose1, studio, atlas2, loose2])

    expect([...grouped.byThread.keys()].sort()).toEqual(['atlas', 'studio'])
    expect(grouped.byThread.get('atlas')).toEqual([atlas1, atlas2])
    expect(grouped.byThread.get('studio')).toEqual([studio])
    expect(grouped.loose).toEqual([loose1, loose2])
  })

  it('returns empty groups for an empty mesh', () => {
    const grouped = groupItemsByThread([])
    expect(grouped.byThread.size).toBe(0)
    expect(grouped.loose).toEqual([])
  })
})

describe('uniqueThoughts', () => {
  it('folds several timeline items of one thought into one row, newest first', () => {
    // one thought can carry a task row and two dated events — it is still one thought
    const older = item({ thoughtId: 't1', createdAt: '2026-10-18T10:00:00Z' })
    const t1a = item({ thoughtId: 't2', createdAt: '2026-10-19T10:00:00Z' })
    const t1b = item({ thoughtId: 't2', createdAt: '2026-10-19T10:00:00Z' })
    const newest = item({ thoughtId: 't3', createdAt: '2026-10-20T08:00:00Z' })

    const rows = uniqueThoughts([older, t1a, newest, t1b])

    expect(rows.map((row) => row.thoughtId)).toEqual(['t3', 't2', 't1'])
  })

  it('keeps the first item seen for a repeated thought (input order is the tie-break)', () => {
    const first = item({ thoughtId: 't1', id: 'first' })
    const second = item({ thoughtId: 't1', id: 'second' })
    expect(uniqueThoughts([first, second])[0].id).toBe('first')
  })
})

describe('threadMeta', () => {
  it('counts thoughts (not items) and finds when the last one was added', () => {
    const items = [
      item({ thoughtId: 't1', createdAt: '2026-10-01T10:00:00Z' }),
      item({ thoughtId: 't1', createdAt: '2026-10-01T10:00:00Z' }),
      item({ thoughtId: 't2', createdAt: '2026-10-19T10:00:00Z' }),
    ]
    expect(threadMeta(items)).toEqual({
      thoughtCount: 2,
      lastAddedIso: '2026-10-19T10:00:00Z',
    })
  })

  it('reports nothing in it yet for an empty thread', () => {
    expect(threadMeta([])).toEqual({ thoughtCount: 0, lastAddedIso: null })
  })
})

describe('openQuestionsOf', () => {
  it('is the open thoughts whose persisted category is the question kind', () => {
    const q1 = item({ thoughtId: 'q1', thoughtCategory: QUESTION_CATEGORY })
    const q1again = item({ thoughtId: 'q1', thoughtCategory: QUESTION_CATEGORY })
    const answered = item({
      thoughtId: 'q2',
      thoughtCategory: QUESTION_CATEGORY,
      thoughtStatus: 'completed',
    })
    const task = item({ thoughtId: 't1', thoughtCategory: 'task' })

    const questions = openQuestionsOf([task, q1, answered, q1again])

    expect(questions.map((row) => row.thoughtId)).toEqual(['q1'])
  })

  it('is the literal category key, never a text pattern', () => {
    // a task that merely ends in a question mark is not a question thought
    const task = item({ thoughtId: 't1', thoughtCategory: 'task' })
    expect(openQuestionsOf([task])).toEqual([])
    expect(QUESTION_CATEGORY).toBe('question')
  })
})

describe('agoLabel (ei app.js:53-60)', () => {
  it('says today, yesterday, then days, weeks and months', () => {
    expect(agoLabel('2026-10-20T07:00:00Z', fmt)).toBe('today')
    expect(agoLabel('2026-10-19T07:00:00Z', fmt)).toBe('yesterday')
    expect(agoLabel('2026-10-15T07:00:00Z', fmt)).toBe('5 days ago')
    expect(agoLabel('2026-10-06T07:00:00Z', fmt)).toBe('2 weeks ago')
    expect(agoLabel('2026-07-20T07:00:00Z', fmt)).toBe('3 months ago')
  })

  it('counts local days in the user zone, not UTC days', () => {
    // 23:30Z on the 19th is already the 20th (today) in Berlin
    expect(agoLabel('2026-10-19T23:30:00Z', fmt)).toBe('today')
    expect(agoLabel('2026-10-19T23:30:00Z', { ...fmt, timeZone: 'UTC' })).toBe('yesterday')
  })

  it('speaks the UI locale', () => {
    expect(agoLabel('2026-10-19T07:00:00Z', { ...fmt, locale: 'de' })).toBe('gestern')
    expect(agoLabel('2026-10-15T07:00:00Z', { ...fmt, locale: 'de' })).toBe('vor 5 Tagen')
  })

  it('refuses an invalid instant instead of guessing', () => {
    expect(() => agoLabel('not-a-date', fmt)).toThrow(/invalid ISO date/)
  })
})

describe('datedLabel (ei app.js:61-66 shortDay)', () => {
  it('shows the clock today, yesterday as a word, then day and short month', () => {
    // locale data decides the shape: en-GB is 24h and day-first, en is 12h and month-first
    expect(datedLabel('2026-10-20T07:12:00Z', { ...fmt, locale: 'en-GB' })).toBe('09:12')
    expect(datedLabel('2026-10-20T07:12:00Z', fmt)).toBe('09:12 AM')
    expect(datedLabel('2026-10-19T07:12:00Z', fmt)).toBe('Yesterday')
    expect(datedLabel('2026-10-02T07:12:00Z', { ...fmt, locale: 'en-GB' })).toBe('2 Oct')
    expect(datedLabel('2026-10-02T07:12:00Z', fmt)).toBe('Oct 2')
  })

  it('speaks the UI locale', () => {
    expect(datedLabel('2026-10-19T07:12:00Z', { ...fmt, locale: 'de' })).toBe('Gestern')
    expect(datedLabel('2026-10-02T07:12:00Z', { ...fmt, locale: 'de' })).toBe('2. Okt.')
  })
})

describe('hrefs — the thread hands off to Capture and Ask by URL only', () => {
  it('capture into a thread presets the thread by entity id', () => {
    expect(captureIntoHref('', 'abc 123')).toBe('/capture?thread=abc%20123')
    expect(captureIntoHref('/app', 'abc')).toBe('/app/capture?thread=abc')
  })

  it('asks where it stands with the question in the query', () => {
    expect(askWhereItStandsHref('', 'Where does Atlas stand?')).toBe(
      '/chat?q=Where%20does%20Atlas%20stand%3F',
    )
  })
})

describe('toThreadThought: the vote on a thread row', () => {
  const item = {
    thoughtId: 't1',
    thoughtText: 'Call the studio',
    createdAt: '2026-10-20T10:00:00Z',
    thoughtCategory: 'task',
    thoughtStatus: 'open' as const,
  }

  it('carries the verdict it was given', () => {
    expect(toThreadThought({ ...item, verdict: 'up' }).verdict).toBe('up')
    expect(toThreadThought({ ...item, verdict: 'down' }).verdict).toBe('down')
  })

  it('is null when the thought was never voted on, or the source has no votes', () => {
    expect(toThreadThought({ ...item, verdict: null }).verdict).toBeNull()
    expect(toThreadThought(item).verdict).toBeNull()
  })
})
