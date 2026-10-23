import type { BoardIdea } from './board-types'
import { describe, expect, it } from 'vitest'
import {
  VOTE_PURSE_SIZE,
  canLendVote,
  lendVote,
  lentVotes,
  purseDots,
  takeBackVote,
  votesLeft,
} from './vote-purse'

/**
 * The purse (DESIGN.md "Votes are scarce"): everyone gets ten a month, shown as clay
 * dots; a vote lent to a request comes back when it ships, and can be taken back any
 * time. Pure math over the board rows — the page only renders what these return.
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

describe('vote purse', () => {
  it('has ten votes a month', () => {
    expect(VOTE_PURSE_SIZE).toBe(10)
  })

  it('counts a vote as lent only while the request is still open', () => {
    const ideas = [
      idea({ id: 'a', mine: true }),
      idea({ id: 'b', mine: true, status: 'in-progress' }),
      idea({ id: 'c', mine: true, status: 'shipped' }), // came back when it shipped
      idea({ id: 'd' }),
    ]
    expect(lentVotes(ideas)).toBe(2)
    expect(votesLeft(ideas)).toBe(VOTE_PURSE_SIZE - 2)
  })

  it('never reports a negative purse', () => {
    const ideas = Array.from({ length: 12 }, (_, i) => idea({ id: `i${i}`, mine: true }))
    expect(votesLeft(ideas)).toBe(0)
    expect(canLendVote(ideas)).toBe(false)
  })

  it('lends a vote: marks it yours and the score ticks up, immutably', () => {
    const before = [idea({ id: 'a', voices: 5 }), idea({ id: 'b' })]
    const after = lendVote(before, 'a')

    expect(after).not.toBe(before)
    expect(before[0].mine).toBeUndefined()
    expect(before[0].voices).toBe(5)
    expect(after[0]).toMatchObject({ id: 'a', mine: true, voices: 6 })
    expect(after[1]).toBe(before[1])
    expect(votesLeft(after)).toBe(VOTE_PURSE_SIZE - 1)
  })

  it('returns the same rows when the vote cannot be lent', () => {
    const full = Array.from({ length: VOTE_PURSE_SIZE }, (_, i) =>
      idea({ id: `m${i}`, mine: true }),
    )
    const target = idea({ id: 'x' })
    const ideas = [...full, target]
    expect(lendVote(ideas, 'x')).toBe(ideas)

    const alreadyMine = [idea({ id: 'a', mine: true, voices: 3 })]
    expect(lendVote(alreadyMine, 'a')).toBe(alreadyMine)

    const shipped = [idea({ id: 's', status: 'shipped' })]
    expect(lendVote(shipped, 's')).toBe(shipped)

    const own = [idea({ id: 'o', own: true, by: 'you' })]
    expect(lendVote(own, 'o')).toBe(own)

    const some = [idea({ id: 'a' })]
    expect(lendVote(some, 'missing')).toBe(some)
  })

  it('takes a vote back: no longer yours, score ticks down, purse refills', () => {
    const before = [idea({ id: 'a', mine: true, voices: 6 })]
    const after = takeBackVote(before, 'a')

    expect(after).not.toBe(before)
    expect(after[0]).toMatchObject({ id: 'a', mine: false, voices: 5 })
    expect(votesLeft(after)).toBe(VOTE_PURSE_SIZE)
  })

  it('leaves rows untouched when taking back a vote that was never lent', () => {
    const ideas = [idea({ id: 'a' })]
    expect(takeBackVote(ideas, 'a')).toBe(ideas)
    expect(takeBackVote(ideas, 'nope')).toBe(ideas)
  })

  it('draws the purse as ten dots, the lent ones hollow at the end (ei app.js:1597)', () => {
    const ideas = [
      idea({ id: 'a', mine: true }),
      idea({ id: 'b', mine: true }),
      idea({ id: 'c', mine: true }),
    ]
    const dots = purseDots(ideas)
    expect(dots).toHaveLength(VOTE_PURSE_SIZE)
    expect(dots.filter(Boolean)).toHaveLength(VOTE_PURSE_SIZE - 3)
    expect(dots.slice(0, 7).every((d) => d === true)).toBe(true)
    expect(dots.slice(7).every((d) => d === false)).toBe(true)
  })
})
