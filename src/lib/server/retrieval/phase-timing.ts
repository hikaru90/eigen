export type RetrievalPhase =
  'embed' | 'vector' | 'lexical' | 'graph' | 'entity' | 'hydrate' | 'decrypt' | 'fuse'

export type RetrievalPhaseTiming = {
  phases: Array<{ phase: RetrievalPhase; ms: number }>
  totalMs: number
}

export function createPhaseTimer(): {
  mark: (phase: RetrievalPhase) => void
  finish: () => RetrievalPhaseTiming
} {
  const startedAt = Date.now()
  const phases: Array<{ phase: RetrievalPhase; ms: number }> = []
  const marks = new Map<RetrievalPhase, number>()

  return {
    mark(phase) {
      marks.set(phase, Date.now())
    },
    finish() {
      const endedAt = Date.now()
      for (const [phase, start] of marks) {
        phases.push({ phase, ms: Math.max(0, endedAt - start) })
      }
      return { phases, totalMs: Math.max(0, endedAt - startedAt) }
    },
  }
}

import { isGraphScaleQuiet } from '$lib/server/observability/graph-scale-quiet'

export function logRetrievalPhaseTiming(input: {
  userId: string
  query: string
  mode: 'fast' | 'full'
  topK: number
  timing: RetrievalPhaseTiming
  /** Log tag override (default: retrieval.searchThoughts). */
  tag?: string
}): void {
  if (isGraphScaleQuiet()) return
  console.info(input.tag ?? '[retrieval.searchThoughts]', {
    userId: input.userId,
    mode: input.mode,
    topK: input.topK,
    queryChars: input.query.length,
    totalMs: input.timing.totalMs,
    phases: input.timing.phases,
  })
}
