/**
 * The vote contract (docs/planning/capture-feedback.md §6), checked before any DB or Jev work.
 * Shared by the HTTP boundary (`parseCaptureVoteBody`) and the service (`validateCaptureVote`), so
 * the same bad vote fails with the same words wherever it comes from. Ambiguous shapes are
 * rejected, not repaired: a reason with a thumbs-up has nothing to apply.
 *
 * No string analysis of the reason's meaning happens here: it is only trimmed and length-checked.
 */

import type { CaptureReviewVerdict, CaptureReviewVotedOn } from '$lib/server/db/schema'

export const CAPTURE_VOTE_REASON_MAX_CHARS = 2000

export type CaptureVote = {
  thoughtId: string
  verdict: CaptureReviewVerdict
  place: CaptureReviewVotedOn
  /** Trimmed; undefined when the vote carries no reason (absent, empty or blank). */
  reason: string | undefined
}

/** A vote that breaks the contract. The message is the exact, user-facing sentence. */
export class CaptureVoteInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureVoteInputError'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateCaptureVote(input: {
  thoughtId: unknown
  verdict: unknown
  place: unknown
  reason?: unknown
}): CaptureVote {
  if (typeof input.thoughtId !== 'string' || !UUID.test(input.thoughtId)) {
    throw new CaptureVoteInputError('thoughtId must be a uuid')
  }
  if (input.verdict !== 'up' && input.verdict !== 'down') {
    throw new CaptureVoteInputError('verdict must be up or down')
  }
  if (input.place !== 'capture' && input.place !== 'mesh') {
    throw new CaptureVoteInputError('place must be capture or mesh')
  }

  let reason: string | undefined
  if (input.reason !== undefined) {
    if (typeof input.reason !== 'string') throw new CaptureVoteInputError('reason must be a string')
    const trimmed = input.reason.trim()
    if (trimmed.length > CAPTURE_VOTE_REASON_MAX_CHARS) {
      throw new CaptureVoteInputError(
        `reason must be at most ${CAPTURE_VOTE_REASON_MAX_CHARS} characters`,
      )
    }
    if (trimmed !== '') reason = trimmed
  }
  if (input.verdict === 'up' && reason !== undefined) {
    throw new CaptureVoteInputError('reason is only allowed with verdict down')
  }

  return { thoughtId: input.thoughtId, verdict: input.verdict, place: input.place, reason }
}

/** The vote as the HTTP body carries it: anything but a JSON object is refused. */
export function parseCaptureVoteBody(body: unknown): CaptureVote {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CaptureVoteInputError('body must be a JSON object')
  }
  const b = body as Record<string, unknown>
  return validateCaptureVote({
    thoughtId: b.thoughtId,
    verdict: b.verdict,
    place: b.place,
    reason: b.reason,
  })
}
