import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BOARD_AREAS, BOARD_KINDS, BOARD_STATUSES } from './board-types'
import { FIXTURE_BOARD_IDEAS, FIXTURE_BOARD_PEOPLE } from './fixture-board'
import { lentVotes } from './vote-purse'
import { VOTE_PURSE_SIZE } from './vote-purse'

/**
 * FIXTURE guard: the sample board must stay well-formed (every row renders,
 * every person resolves, the purse math stays in range) and must stay loudly
 * marked as a fixture until the real board API replaces it.
 */

describe('fixture board', () => {
  it('is marked as a fixture at the top of the file', () => {
    const src = readFileSync(fileURLToPath(new URL('./fixture-board.ts', import.meta.url)), 'utf8')
    expect(src.startsWith('// FIXTURE — replace with the real board API')).toBe(true)
  })

  it('has unique ids and only known kinds, areas and statuses', () => {
    const ids = FIXTURE_BOARD_IDEAS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of FIXTURE_BOARD_IDEAS) {
      expect(BOARD_KINDS).toContain(row.kind)
      expect(BOARD_AREAS).toContain(row.area)
      expect(BOARD_STATUSES).toContain(row.status)
      expect(row.title.trim().length).toBeGreaterThan(0)
      expect(row.voices).toBeGreaterThanOrEqual(1)
      expect(row.daysAgo).toBeGreaterThanOrEqual(0)
    }
  })

  it('resolves every author to a person (or to you)', () => {
    for (const row of FIXTURE_BOARD_IDEAS) {
      if (row.by === 'you') {
        expect(row.own).toBe(true)
        continue
      }
      expect(FIXTURE_BOARD_PEOPLE[row.by]).toBeDefined()
    }
  })

  it('gives shipped rows a shipped date and no others', () => {
    for (const row of FIXTURE_BOARD_IDEAS) {
      if (row.status === 'shipped') expect(row.shippedDaysAgo).toBeGreaterThanOrEqual(0)
      else expect(row.shippedDaysAgo).toBeUndefined()
    }
  })

  it('fills every tab so the board demos all three', () => {
    for (const status of BOARD_STATUSES) {
      expect(FIXTURE_BOARD_IDEAS.some((i) => i.status === status)).toBe(true)
    }
  })

  it('leaves votes in the purse and shows one that came back', () => {
    const lent = lentVotes(FIXTURE_BOARD_IDEAS)
    expect(lent).toBeGreaterThan(0)
    expect(lent).toBeLessThan(VOTE_PURSE_SIZE)
    expect(FIXTURE_BOARD_IDEAS.some((i) => i.status === 'shipped' && i.mine)).toBe(true)
  })

  it('does not reuse the ei prototype sample titles verbatim', () => {
    const eiTitles = [
      'Capture from the menu bar without opening the app',
      'Export a pattern as a markdown note',
      'Share a thread with a friend, read‑only',
      'Let me pin a thought so it doesn’t drift away',
      'Ask should remember my previous question',
      'A warmer, softer dark mode for late nights',
      'Voice capture cuts off long sentences',
      'Patterns feel cramped on a phone',
      'Yarn shows the wrong day just after midnight',
      'Type # to put a thought on a thread',
      'Echoes — show older thoughts that rhyme',
      'Forget a thought without a scary dialog',
    ]
    for (const row of FIXTURE_BOARD_IDEAS) expect(eiTitles).not.toContain(row.title)
  })
})
