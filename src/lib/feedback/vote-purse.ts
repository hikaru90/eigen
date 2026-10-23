import type { BoardIdea } from './board-types'

/**
 * The purse (DESIGN.md "Votes are scarce"): everyone gets ten votes a month, shown
 * as clay dots. A vote is *lent* to a request and comes back when the request ships;
 * it can be taken back any time. Pure, immutable math over the board rows — the page
 * renders what these return and never keeps a second count.
 */

export const VOTE_PURSE_SIZE = 10

/** Votes currently out of the purse: yours, on requests that have not shipped. */
export function lentVotes(ideas: readonly BoardIdea[]): number {
  let n = 0
  for (const idea of ideas) if (idea.mine && idea.status !== 'shipped') n++
  return n
}

export function votesLeft(ideas: readonly BoardIdea[]): number {
  return Math.max(0, VOTE_PURSE_SIZE - lentVotes(ideas))
}

export function canLendVote(ideas: readonly BoardIdea[]): boolean {
  return votesLeft(ideas) > 0
}

/**
 * Lend a vote to `id`: it becomes yours and its score ticks up. Returns the same
 * array when nothing can change (purse empty, already yours, shipped, your own row,
 * or unknown id) so callers can tell "nothing happened" by reference.
 */
export function lendVote(ideas: readonly BoardIdea[], id: string): readonly BoardIdea[] {
  const target = ideas.find((i) => i.id === id)
  if (!target || target.mine || target.own || target.status === 'shipped') return ideas
  if (!canLendVote(ideas)) return ideas
  return ideas.map((i) => (i.id === id ? { ...i, mine: true, voices: i.voices + 1 } : i))
}

/** Take your vote back from `id`. Same-reference when it was never yours. */
export function takeBackVote(ideas: readonly BoardIdea[], id: string): readonly BoardIdea[] {
  const target = ideas.find((i) => i.id === id)
  if (!target || !target.mine) return ideas
  return ideas.map((i) =>
    i.id === id ? { ...i, mine: false, voices: Math.max(0, i.voices - 1) } : i,
  )
}

/**
 * The purse as ten dots (ei app.js:1597): the first `votesLeft` are filled clay,
 * the rest hollow — the lent ones sit at the end.
 */
export function purseDots(ideas: readonly BoardIdea[]): boolean[] {
  const left = votesLeft(ideas)
  return Array.from({ length: VOTE_PURSE_SIZE }, (_, k) => k < left)
}
