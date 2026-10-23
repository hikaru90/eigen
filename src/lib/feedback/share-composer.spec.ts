import { describe, expect, it } from 'vitest'
import { BOARD_AREAS, BOARD_KINDS, type BoardIdea } from './board-types'
import {
  DEFAULT_READING,
  canShare,
  findExactDuplicate,
  nextArea,
  nextKind,
  normalizeTitle,
} from './share-composer'

/**
 * The share composer (DESIGN.md "The same gesture as capture"): one field, then ↵.
 * The reading line ("Sounds like a bug in Capture") is MANUAL this pass: both
 * underlined words cycle on tap, nothing guesses from the text (repo guardrail —
 * meaning comes from an LLM contract, which the board backend pass brings).
 * The chorus card fires only on an exact duplicate title: dedup, not similarity.
 */

function idea(over: Partial<BoardIdea> & { id: string }): BoardIdea {
  return {
    title: `row ${over.id}`,
    kind: 'idea',
    area: 'capture',
    by: 'noor',
    daysAgo: 1,
    voices: 5,
    status: 'requested',
    ...over,
  }
}

describe('share composer', () => {
  it('starts the reading at "an idea" in "everywhere" — a chooser, not a guess', () => {
    expect(DEFAULT_READING).toEqual({ kind: 'idea', area: 'everywhere' })
  })

  it('cycles the kind through the three kinds and wraps', () => {
    let k = DEFAULT_READING.kind
    const seen = [k]
    for (let i = 0; i < BOARD_KINDS.length; i++) {
      k = nextKind(k)
      seen.push(k)
    }
    expect(seen.slice(0, BOARD_KINDS.length)).toEqual([...BOARD_KINDS])
    expect(seen[BOARD_KINDS.length]).toBe(BOARD_KINDS[0])
  })

  it('cycles the area through every area and wraps', () => {
    let a = BOARD_AREAS[0]
    const seen = [a]
    for (let i = 0; i < BOARD_AREAS.length; i++) {
      a = nextArea(a)
      seen.push(a)
    }
    expect(seen.slice(0, BOARD_AREAS.length)).toEqual([...BOARD_AREAS])
    expect(seen[BOARD_AREAS.length]).toBe(BOARD_AREAS[0])
  })

  it('can share once there are words, up to the shared feedback limit', () => {
    expect(canShare('', 20)).toBe(false)
    expect(canShare('   \n ', 20)).toBe(false)
    expect(canShare('Something', 20)).toBe(true)
    expect(canShare('x'.repeat(20), 20)).toBe(true)
    expect(canShare('x'.repeat(21), 20)).toBe(false)
  })

  it('normalizes a title only for equality: trim, collapse whitespace, case-fold', () => {
    expect(normalizeTitle('  Offline   capture\tthat syncs\nlater ')).toBe(
      'offline capture that syncs later',
    )
    expect(normalizeTitle('')).toBe('')
  })

  it('finds an exact duplicate among open requests — not among shipped or your own rows', () => {
    const ideas = [
      idea({ id: 'open', title: 'Offline capture that syncs later' }),
      idea({ id: 'shipped', title: 'Dark mode', status: 'shipped', shippedDaysAgo: 4 }),
      idea({ id: 'own', title: 'My own request', own: true, by: 'you' }),
      idea({ id: 'loom', title: 'Faster search', status: 'in-progress' }),
    ]
    expect(findExactDuplicate(ideas, 'offline CAPTURE that   syncs later')?.id).toBe('open')
    expect(findExactDuplicate(ideas, 'faster search')?.id).toBe('loom')
    expect(findExactDuplicate(ideas, 'Dark mode')).toBeNull()
    expect(findExactDuplicate(ideas, 'My own request')).toBeNull()
    expect(findExactDuplicate(ideas, '')).toBeNull()
  })

  it('never calls near-copies duplicates (that judgement belongs to the board backend)', () => {
    const ideas = [idea({ id: 'open', title: 'Offline capture that syncs later' })]
    expect(findExactDuplicate(ideas, 'Offline capture that syncs')).toBeNull()
    expect(findExactDuplicate(ideas, 'capture offline, sync later')).toBeNull()
  })
})
