import type { BoardIdea, MyVote, VoteDirection } from './board-types'

/**
 * Up- and downvotes, Reddit-style: one vote per idea, unlimited. Tapping your
 * current direction again takes the vote back (0); tapping the other flips it.
 * The server is the authority — the page sends this direction, then re-fetches.
 */
export function nextVoteDirection(current: MyVote, tapped: VoteDirection): MyVote {
  return current === tapped ? 0 : tapped
}

/**
 * Shipped ideas are closed. Your own idea carries your +1 from sharing (D2): you
 * can take it back or put it back, but not vote your own idea down.
 */
export function canVote(idea: BoardIdea, tapped: VoteDirection): boolean {
  if (idea.status === 'shipped') return false
  if (idea.own && tapped === -1) return false
  return true
}
