import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { runWithTrace } from '$lib/server/activity/trace-context'
import { voteOnCapture } from '$lib/server/capture-review/vote'
import { CaptureVoteError } from '$lib/server/capture-review/vote-error'
import { CaptureVoteInputError, parseCaptureVoteBody } from '$lib/server/capture-review/vote-input'

/**
 * The owner's vote on a stored thought (docs/planning/capture-feedback.md §6), from the kept strip
 * on Capture (`place: 'capture'`) or an unfolded Mesh row (`place: 'mesh'`).
 *
 * Body: { thoughtId, verdict: 'up' | 'down', place: 'capture' | 'mesh', reason? }. A reason goes
 * with a thumbs-down only: it is labelled by Jev (kind of mistake), applied as an edit, and the
 * answer carries the edited thought. Answers { verdict, reasonKind, editApplied, editError, thought }:
 * a failed edit is a 200 with `editError` (the vote and label are stored), never swallowed.
 *
 * 400 a bad vote (exact messages, checked before any work), 401 no user, 404 no such thought,
 * 502 the kind-of-mistake label could not be made (nothing was stored; send again).
 */
export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  let vote: ReturnType<typeof parseCaptureVoteBody>
  try {
    vote = parseCaptureVoteBody(body)
  } catch (err) {
    if (err instanceof CaptureVoteInputError) error(400, err.message)
    throw err
  }

  try {
    const result = await runWithTrace(crypto.randomUUID(), () =>
      voteOnCapture({ userId: user.id, ...vote }),
    )
    return json(result)
  } catch (err) {
    if (err instanceof CaptureVoteInputError) error(400, err.message)
    if (err instanceof CaptureVoteError) {
      error(err.code === 'not_found' ? 404 : 502, err.message)
    }
    // Ids only: the vote's reason and the thought's words never go to the log.
    console.error('[capture.review.vote.api] failed', {
      userId: user.id,
      thoughtId: vote.thoughtId,
      errorName: err instanceof Error ? err.name : typeof err,
    })
    error(500, err instanceof Error ? err.message : 'Failed to store the vote')
  }
}
