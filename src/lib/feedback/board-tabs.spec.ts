import type { BoardIdea } from './board-types'
import { describe, expect, it } from 'vitest'
import {
  BOARD_TABS,
  STAGE_DOTS,
  inTab,
  matchesBoardQuery,
  mostWantedId,
  sortForTab,
  stageOf,
  tabCounts,
} from './board-tabs'

/**
 * The board (DESIGN.md "The board"): three tabs in plain words — Requested,
 * In progress, Shipped — with counts; the top requested idea is "Most wanted";
 * every row shows four dots for how far it has come. Filtering and ordering are
 * pure functions over the rows; the page only renders their result.
 */

function idea(over: Partial<BoardIdea> & { id: string }): BoardIdea {
  return {
    title: `row ${over.id}`,
    kind: 'idea',
    area: 'capture',
    status: 'requested',
    planned: false,
    note: null,
    score: 5,
    myVote: 0,
    author: { display: 'Noor K.', isYou: false },
    createdAt: '2026-10-20T10:00:00.000Z',
    shippedAt: null,
    own: false,
    ...over,
  }
}

function shippedDaysAgo(days: number): string {
  return new Date(Date.UTC(2026, 9, 23) - days * 86_400_000).toISOString()
}

describe('board tabs', () => {
  it('names the three tabs in order', () => {
    expect(BOARD_TABS).toEqual(['requested', 'in-progress', 'shipped'])
  })

  it('puts each row in exactly one tab, by status', () => {
    const rows = [
      idea({ id: 'r', status: 'requested' }),
      idea({ id: 'p', status: 'requested', planned: true }),
      idea({ id: 'l', status: 'in-progress' }),
      idea({ id: 's', status: 'shipped', shippedAt: shippedDaysAgo(2) }),
    ]
    for (const row of rows) {
      const tabs = BOARD_TABS.filter((t) => inTab(row, t))
      expect(tabs).toEqual([row.status])
    }
  })

  it('counts rows per tab', () => {
    const rows = [
      idea({ id: 'a' }),
      idea({ id: 'b', planned: true }),
      idea({ id: 'c', status: 'in-progress' }),
      idea({ id: 'd', status: 'shipped', shippedAt: shippedDaysAgo(1) }),
      idea({ id: 'e', status: 'shipped', shippedAt: shippedDaysAgo(9) }),
    ]
    expect(tabCounts(rows)).toEqual({ requested: 2, 'in-progress': 1, shipped: 2 })
  })

  it('shows how far a row has come as four dots: heard, planned, on the loom, shipped', () => {
    expect(STAGE_DOTS).toBe(4)
    expect(stageOf(idea({ id: 'a' }))).toBe(1)
    expect(stageOf(idea({ id: 'b', planned: true }))).toBe(2)
    expect(stageOf(idea({ id: 'c', status: 'in-progress' }))).toBe(3)
    expect(stageOf(idea({ id: 'd', status: 'shipped', shippedAt: shippedDaysAgo(0) }))).toBe(4)
    // planned means nothing once work has started
    expect(stageOf(idea({ id: 'e', status: 'in-progress', planned: true }))).toBe(3)
  })

  it('orders open tabs by votes, with what you shared on top (ei app.js:1589)', () => {
    const rows = [
      idea({ id: 'low', score: 3 }),
      idea({ id: 'high', score: 90 }),
      idea({ id: 'own', score: 1, own: true }),
      idea({ id: 'mid', score: 40 }),
      idea({ id: 'loom', score: 999, status: 'in-progress' }),
    ]
    expect(sortForTab(rows, 'requested').map((r) => r.id)).toEqual(['own', 'high', 'mid', 'low'])
    expect(sortForTab(rows, 'in-progress').map((r) => r.id)).toEqual(['loom'])
  })

  it('orders Shipped by what shipped most recently (ei app.js:1588)', () => {
    const rows = [
      idea({ id: 'older', status: 'shipped', shippedAt: shippedDaysAgo(31) }),
      idea({ id: 'newest', status: 'shipped', shippedAt: shippedDaysAgo(3) }),
      idea({ id: 'mid', status: 'shipped', shippedAt: shippedDaysAgo(16) }),
      idea({ id: 'open' }),
    ]
    expect(sortForTab(rows, 'shipped').map((r) => r.id)).toEqual(['newest', 'mid', 'older'])
  })

  it('does not mutate the rows it sorts', () => {
    const rows = [idea({ id: 'b', score: 1 }), idea({ id: 'a', score: 9 })]
    const copy = [...rows]
    sortForTab(rows, 'requested')
    expect(rows).toEqual(copy)
  })

  it('marks the most wanted only on Requested, skipping what you shared yourself', () => {
    const requested = sortForTab(
      [
        idea({ id: 'own', own: true, score: 1 }),
        idea({ id: 'top', score: 50 }),
        idea({ id: 'x', score: 2 }),
      ],
      'requested',
    )
    expect(mostWantedId(requested, 'requested')).toBe('top')
    expect(mostWantedId(requested, 'in-progress')).toBeNull()
    expect(mostWantedId(requested, 'shipped')).toBeNull()
    expect(mostWantedId([], 'requested')).toBeNull()
    expect(mostWantedId([idea({ id: 'only-own', own: true })], 'requested')).toBeNull()
  })

  it('search filters rows by their visible words (title and makers note), never by meaning', () => {
    const row = idea({
      id: 'a',
      title: 'Offline capture that syncs later',
      note: 'We can reproduce it.',
    })
    expect(matchesBoardQuery(row, '')).toBe(true)
    expect(matchesBoardQuery(row, '  ')).toBe(true)
    expect(matchesBoardQuery(row, 'OFFLINE')).toBe(true)
    expect(matchesBoardQuery(row, 'reproduce')).toBe(true)
    expect(matchesBoardQuery(row, 'yarn')).toBe(false)
    expect(matchesBoardQuery(idea({ id: 'b', title: 'Plain' }), 'reproduce')).toBe(false)
  })
})
