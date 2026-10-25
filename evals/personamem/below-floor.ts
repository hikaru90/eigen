import type { BelowFloorScores } from '$lib/server/qa/compose-observer'

const best = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

/** The best below-floor score per side over every compose call of one question. */
export function mergeBelowFloor(observed: readonly BelowFloorScores[]): BelowFloorScores {
  return observed.reduce<BelowFloorScores>(
    (merged, scores) => ({
      thoughts: best(merged.thoughts, scores.thoughts),
      notePassages: best(merged.notePassages, scores.notePassages),
    }),
    { thoughts: null, notePassages: null },
  )
}
