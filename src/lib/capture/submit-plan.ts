/**
 * The one-call submit decision (ei redesign decision #3): the user saw and could edit
 * the reading pre-submit, so pressing Capture is the confirmation — no modal.
 *
 *  - fresh reading, online → keep it (POST /api/capture/keep { raw, reading }): the one
 *    call that persists; raw_text keeps the typed words, the accepted interpretation →
 *    normalized_text, enrich scheduled.
 *  - stale reading, no reading, or offline → the client capture queue
 *    (enqueueCapture → POST /api/capture/submit {raw}, Background Sync when offline),
 *    whose payload shape is unchanged.
 */
import type { CapturePreviewBundle } from './confirmation-types'
import { isReadingFresh, type ReadingDraft } from './reading-state'

export type SubmitPlan =
  | { kind: 'none' }
  | { kind: 'keep'; reading: CapturePreviewBundle }
  | { kind: 'enqueue' }

export function planCaptureSubmit(input: {
  raw: string
  draft: ReadingDraft | null
  blocked?: boolean
  offline?: boolean
}): SubmitPlan {
  const raw = input.raw.trim()
  if (!raw || input.blocked) return { kind: 'none' }
  if (!input.offline && isReadingFresh(input.draft, raw)) {
    return { kind: 'keep', reading: (input.draft as ReadingDraft).reading }
  }
  return { kind: 'enqueue' }
}
