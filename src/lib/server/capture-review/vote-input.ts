/**
 * The vote contract (docs/planning/capture-feedback.md §6), checked before any DB or Jev work.
 * Shared by the HTTP boundary (`parseCaptureVoteBody`) and the service (`validateCaptureVote`), so
 * the same bad vote fails with the same words wherever it comes from. Ambiguous shapes are
 * rejected, not repaired: a reason with a thumbs-up has nothing to apply.
 *
 * No string analysis of the reason's meaning happens here: it is only trimmed and length-checked.
 */

import type { CaptureReviewVerdict } from '$lib/server/db/schema'

export const CAPTURE_VOTE_REASON_MAX_CHARS = 2000

/** The two places in the app that offer the vote: the kept strip on Capture and the Mesh row. */
export const CAPTURE_VOTE_UI_PLACES = ['capture', 'mesh'] as const

/** Where a vote can come from: the two app places, or an agent over MCP (`rate_capture`). */
export const CAPTURE_VOTE_PLACES = [...CAPTURE_VOTE_UI_PLACES, 'mcp'] as const
export type CaptureVotePlace = (typeof CAPTURE_VOTE_PLACES)[number]

export type CaptureVote = {
  thoughtId: string
  verdict: CaptureReviewVerdict
  place: CaptureVotePlace
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

/** True for a thought id: a uuid, exactly (no surrounding whitespace). */
export function isCaptureVoteThoughtId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** "capture or mesh", "capture, mesh or mcp": the places a caller may name, in words. */
function placesInWords(places: readonly CaptureVotePlace[]): string {
  return `${places.slice(0, -1).join(', ')} or ${places[places.length - 1]}`
}

/**
 * The vote contract. `places` is where this caller's votes may come from: every place for a typed
 * service caller (the MCP tool names `mcp`), only the two app places for the HTTP body.
 */
export function validateCaptureVote(
  input: {
    thoughtId: unknown
    verdict: unknown
    place: unknown
    reason?: unknown
  },
  places: readonly CaptureVotePlace[] = CAPTURE_VOTE_PLACES,
): CaptureVote {
  if (!isCaptureVoteThoughtId(input.thoughtId)) {
    throw new CaptureVoteInputError('thoughtId must be a uuid')
  }
  if (input.verdict !== 'up' && input.verdict !== 'down') {
    throw new CaptureVoteInputError('verdict must be up or down')
  }
  const place = places.find((candidate) => candidate === input.place)
  if (place === undefined) {
    throw new CaptureVoteInputError(`place must be ${placesInWords(places)}`)
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

  return { thoughtId: input.thoughtId, verdict: input.verdict, place, reason }
}

/** The vote as the HTTP body carries it: anything but a JSON object is refused, and it never says `mcp`. */
export function parseCaptureVoteBody(body: unknown): CaptureVote {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CaptureVoteInputError('body must be a JSON object')
  }
  const b = body as Record<string, unknown>
  return validateCaptureVote(
    {
      thoughtId: b.thoughtId,
      verdict: b.verdict,
      place: b.place,
      reason: b.reason,
    },
    CAPTURE_VOTE_UI_PLACES,
  )
}
