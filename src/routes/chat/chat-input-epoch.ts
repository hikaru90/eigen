/**
 * Monotonic epoch used to drop stale voice transcripts after a submit.
 *
 * The counter is bumped on every submit (send / resend / regenerate) and on every
 * new voice recording start. A transcript (partial or final) is applied to the
 * composer input only when the epoch captured at record-start still matches the
 * current epoch — i.e. no submit has happened since the recording that produced
 * the transcript began. This is a deterministic guard (no string heuristics).
 *
 * The epoch is a plain mutable object (not Svelte `$state`): transcript handlers
 * read `epoch.current` at invocation time, so they always observe the latest value
 * without needing reactivity.
 */
export type InputEpoch = { current: number }

export function createInputEpoch(): InputEpoch {
  return { current: 0 }
}

/** Increment the epoch and return the new value. */
export function bumpInputEpoch(epoch: InputEpoch): number {
  epoch.current += 1
  return epoch.current
}

/**
 * True when no submit has bumped the epoch since `recordedAt`.
 * Used to decide whether a late partial/final transcript is still fresh.
 */
export function isFreshTranscript(epoch: InputEpoch, recordedAt: number): boolean {
  return epoch.current === recordedAt
}
