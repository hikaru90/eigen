import { describe, expect, it } from 'vitest'
import { BOARD_AREAS, BOARD_KINDS } from './board-types'
import { canShare, nextArea, nextKind } from './share-composer'

/**
 * The share composer's pure parts. Kind and area come from the board's LLM judge
 * (POST /api/board/ideas/check); the cycles below are how the author corrects them
 * on their own Requested row (D5). Duplicates are the judge's call — nothing here
 * compares titles.
 */

describe('share composer', () => {
  it('cycles the kind through the three kinds and wraps', () => {
    let k = BOARD_KINDS[0]
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

})
