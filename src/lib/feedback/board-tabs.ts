import { rowMatchesQuery } from '$lib/mesh/filter-matcher'
import { BOARD_STATUSES, type BoardIdea, type BoardStatus } from './board-types'

/**
 * The board (DESIGN.md "The board"): three tabs in plain words with counts, the
 * top requested idea marked "Most wanted", four dots on every row for how far it
 * has come. Pure functions over the rows (ei app.js:1581-1593); the page renders
 * their result and swaps tabs with one crossfade.
 */

export type BoardTab = BoardStatus
export const BOARD_TABS: readonly BoardTab[] = BOARD_STATUSES

/** Four dots: heard → planned → on the loom → shipped. */
export const STAGE_DOTS = 4

/** How many of the four dots are lit for a row. */
export function stageOf(idea: BoardIdea): 1 | 2 | 3 | 4 {
  switch (idea.status) {
    case 'shipped':
      return 4
    case 'in-progress':
      return 3
    default:
      return idea.planned ? 2 : 1
  }
}

export function inTab(idea: BoardIdea, tab: BoardTab): boolean {
  return idea.status === tab
}

export function tabCounts(ideas: readonly BoardIdea[]): Record<BoardTab, number> {
  const counts: Record<BoardTab, number> = { requested: 0, 'in-progress': 0, shipped: 0 }
  for (const idea of ideas) counts[idea.status]++
  return counts
}

/**
 * The rows of one tab, in reading order (ei app.js:1587-1589): Shipped shows the
 * most recent first; open tabs put what you shared on top, then the most voted.
 * Never mutates the input.
 */
export function sortForTab(ideas: readonly BoardIdea[], tab: BoardTab): BoardIdea[] {
  const rows = ideas.filter((i) => inTab(i, tab))
  if (tab === 'shipped') {
    return rows.sort((a, b) => shippedTime(b) - shippedTime(a))
  }
  return rows.sort((a, b) => Number(b.own) - Number(a.own) || b.score - a.score)
}

function shippedTime(idea: BoardIdea): number {
  return idea.shippedAt ? Date.parse(idea.shippedAt) : 0
}

/**
 * "Most wanted": the top idea on Requested that someone else asked for
 * (ei app.js:1590). Null on the other tabs or when only your own rows remain.
 */
export function mostWantedId(sortedRows: readonly BoardIdea[], tab: BoardTab): string | null {
  if (tab !== 'requested') return null
  return sortedRows.find((i) => !i.own)?.id ?? null
}

/** Board search: plain-text match on the words a row shows (title and makers note). */
export function matchesBoardQuery(idea: BoardIdea, query: string): boolean {
  return rowMatchesQuery(`${idea.title}\n${idea.note ?? ''}`, query)
}

/**
 * Which empty state the board shows: `board` when nobody has suggested anything,
 * `tab` when only the current tab is empty, `null` while loading, searching, or
 * whenever there are rows to show.
 */
export function boardEmptyVariant(state: {
  loaded: boolean
  query: string
  visibleCount: number
  totalCount: number
}): 'board' | 'tab' | null {
  if (!state.loaded || state.query.trim().length > 0 || state.visibleCount > 0) return null
  return state.totalCount === 0 ? 'board' : 'tab'
}
