/**
 * End of enrichment: record the capture review and queue its audit
 * (docs/planning/capture-feedback.md §3).
 *
 * The review starts with Jev's confidence for the decisions Jev made at capture (the parts), no score,
 * and `pending_audit`. The score arrives when the background audit job has checked what the chat
 * model wrote. Failing to write the review or to enqueue the job throws: the caller owns the retry.
 */

import type { RecordedDecision } from './decision-recorder'
import { enqueueUserJob } from '$lib/server/job-queue/enqueue'
import { CAPTURE_REVIEW_AUDIT_JOB, CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS } from './job'
import { decisionsToParts } from './review-parts'
import { upsertPendingCaptureReview } from './review-store'

export async function recordCaptureReview(input: {
  userId: string
  thoughtId: string
  decisions: RecordedDecision[]
}): Promise<void> {
  await upsertPendingCaptureReview({
    userId: input.userId,
    thoughtId: input.thoughtId,
    parts: decisionsToParts(input.decisions),
  })

  // No dedupe key: each enrichment queues its own audit so the latest state is always the one
  // scored. The job reads the thought when it runs and ignores a review that is no longer pending.
  const queued = await enqueueUserJob({
    userId: input.userId,
    jobType: CAPTURE_REVIEW_AUDIT_JOB,
    runAfter: new Date(),
    payload: { thoughtId: input.thoughtId },
    maxAttempts: CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS,
  })
  if (!queued.enqueued) {
    throw new Error(
      `[capture-review] ${CAPTURE_REVIEW_AUDIT_JOB} job was not enqueued (${queued.reason})`,
    )
  }
}
