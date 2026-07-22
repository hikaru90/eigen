import type { EvalEntry } from '$lib/server/db/brain.schema'

/** Collect consecutive pending entries that share the same parallelWave id. */
export function collectNextWave(pending: readonly EvalEntry[]): EvalEntry[] {
  if (pending.length === 0) return []
  const first = pending[0]!
  const waveId = first.inputJson?.parallelWave
  if (typeof waveId !== 'string' || !waveId.trim()) {
    return [first]
  }

  const wave: EvalEntry[] = []
  for (const entry of pending) {
    if (entry.inputJson?.parallelWave === waveId) {
      wave.push(entry)
    } else {
      break
    }
  }
  return wave
}
