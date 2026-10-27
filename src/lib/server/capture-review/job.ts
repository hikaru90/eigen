/**
 * The `capture_review_audit` background job: one per finished enrichment, audits what the chat model
 * wrote for a capture (docs/planning/capture-feedback.md §4). Kept apart from the handler so the
 * enrichment side (enqueue) and the queue side (dispatch) share the constants without a cycle.
 */

import { z } from 'zod'
import { INGEST_MAX_RETRIES } from '$lib/server/ingest/retry'

export const CAPTURE_REVIEW_AUDIT_JOB = 'capture_review_audit' as const

/**
 * The ingest retry policy (AGENTS.md): the first try plus exactly INGEST_MAX_RETRIES retries, then
 * the job is given up and the review is marked `audit_failed`. `user_job_queue.max_attempts` counts
 * every try, including the first.
 */
export const CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS = 1 + INGEST_MAX_RETRIES

const payloadSchema = z.strictObject({ thoughtId: z.string().trim().min(1) })

export type CaptureReviewAuditPayload = z.infer<typeof payloadSchema>

/** The job payload holds the thought id only. A malformed payload fails the job loudly. */
export function parseCaptureReviewAuditPayload(payload: unknown): CaptureReviewAuditPayload {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(
      `[capture-review] ${CAPTURE_REVIEW_AUDIT_JOB} payload must be exactly { thoughtId }`,
    )
  }
  return parsed.data
}
