import type { BoardIdea } from './board-types'
import { describe, expect, it } from 'vitest'
import { canVote, nextVoteDirection } from './votes'

const idea = (over: Partial<BoardIdea> = {}): BoardIdea => ({
  id: 'a',
  title: 'x',
  kind: 'idea',
  area: 'capture',
  status: 'requested',
  planned: false,
  note: null,
  score: 10,
  myVote: 0,
  author: { display: 'Noor K.', isYou: false },
  createdAt: '2026-10-20T10:00:00.000Z',
  shippedAt: null,
  own: false,
  ...over,
})

describe('nextVoteDirection (what the PUT sends)', () => {
  it('AC-3/AC-4: votes, flips, and taking the same direction again removes the vote', () => {
    expect(nextVoteDirection(0, 1)).toBe(1)
    expect(nextVoteDirection(1, -1)).toBe(-1)
    expect(nextVoteDirection(-1, -1)).toBe(0)
    expect(nextVoteDirection(1, 1)).toBe(0)
    expect(nextVoteDirection(-1, 1)).toBe(1)
  })
})

describe('canVote', () => {
  it('lets anyone vote either way on open ideas', () => {
    expect(canVote(idea(), 1)).toBe(true)
    expect(canVote(idea({ status: 'in-progress' }), -1)).toBe(true)
  })

  it('AC-6: shipped ideas are closed', () => {
    expect(canVote(idea({ status: 'shipped' }), 1)).toBe(false)
    expect(canVote(idea({ status: 'shipped' }), -1)).toBe(false)
  })

  it('D2: your own idea carries your +1 — you can take it back or re-add it, never downvote it', () => {
    expect(canVote(idea({ own: true, myVote: 1 }), 1)).toBe(true)
    expect(canVote(idea({ own: true, myVote: 0 }), 1)).toBe(true)
    expect(canVote(idea({ own: true, myVote: 1 }), -1)).toBe(false)
  })
})
