/**
 * The two ways a valid vote still cannot be stored (docs/planning/capture-feedback.md §6). Kept
 * apart from `vote.ts` so the HTTP layer can tell them apart without loading the edit pipeline.
 * An invalid vote is a `CaptureVoteInputError` (`vote-input.ts`) instead.
 */

export type CaptureVoteErrorCode = 'not_found' | 'label_failed'

/** `not_found`: the thought is not there. `label_failed`: Jev's label failed after the ingest ladder; nothing was stored. */
export class CaptureVoteError extends Error {
  readonly code: CaptureVoteErrorCode
  constructor(code: CaptureVoteErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CaptureVoteError'
    this.code = code
  }
}
