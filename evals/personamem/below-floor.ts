import type { BelowFloorScores } from '$lib/server/qa/compose-observer'

const best = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

/** The best below-floor thought score over every compose call of one question. */
export function mergeBelowFloor(observed: readonly BelowFloorScores[]): BelowFloorScores {
  return observed.reduce<BelowFloorScores>(
    (merged, scores) => ({ thoughts: best(merged.thoughts, scores.thoughts) }),
    { thoughts: null },
  )
}
