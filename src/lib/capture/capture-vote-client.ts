import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'

/**
 * The owner's 👍/👎 on a stored thought (docs/planning/capture-feedback.md §6): native fetch against
 * POST /api/capture/review/vote. A reason goes with a thumbs-down only and is applied as an edit by
 * the server; the answer carries the edited thought. Failures throw with the server's own message
 * (nothing is swallowed); a failed edit is NOT a failure here — the vote is stored and the answer
 * names the error (`editError`).
 */
export type CaptureVoteVerdict = 'up' | 'down'
export type CaptureVotePlace = 'capture' | 'mesh'

export type CaptureVoteAnswer = {
  verdict: CaptureVoteVerdict
  /** The closed label of the mistake the reason described; null without a reason. */
  reasonKind: string | null
  editApplied: boolean
  editError: string | null
  /** The thought as the edit left it, when an edit ran. */
  thought: CaptureSubmitResult | null
}

async function failure(res: Response): Promise<Error> {
  const payload = (await res.json().catch(() => null)) as {
    message?: unknown
    error?: unknown
  } | null
  const reason =
    typeof payload?.message === 'string' && payload.message.trim() !== ''
      ? payload.message
      : typeof payload?.error === 'string' && payload.error.trim() !== ''
        ? payload.error
        : `Vote failed (${res.status})`
  return new Error(reason)
}

function parseAnswer(body: unknown): CaptureVoteAnswer {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const thought = b.thought
  const understood =
    (b.verdict === 'up' || b.verdict === 'down') &&
    (b.reasonKind === null || typeof b.reasonKind === 'string') &&
    typeof b.editApplied === 'boolean' &&
    (b.editError === null || typeof b.editError === 'string') &&
    (thought === null || (typeof thought === 'object' && thought !== null))
  if (!understood) throw new Error('Vote answer was not understood')
  return {
    verdict: b.verdict as CaptureVoteVerdict,
    reasonKind: b.reasonKind as string | null,
    editApplied: b.editApplied as boolean,
    editError: b.editError as string | null,
    thought: thought as CaptureSubmitResult | null,
  }
}

export async function postCaptureVote(vote: {
  thoughtId: string
  verdict: CaptureVoteVerdict
  place: CaptureVotePlace
  reason?: string
}): Promise<CaptureVoteAnswer> {
  const res = await fetch('/api/capture/review/vote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      thoughtId: vote.thoughtId,
      verdict: vote.verdict,
      place: vote.place,
      ...(vote.reason === undefined ? {} : { reason: vote.reason }),
    }),
    credentials: 'same-origin',
  })
  if (!res.ok) throw await failure(res)
  return parseAnswer(await res.json())
}
