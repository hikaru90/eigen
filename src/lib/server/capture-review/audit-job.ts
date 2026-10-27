/**
 * Queue handler for the `capture_review_audit` job (dispatched by `drainUserJobQueue` inside
 * `withDbUser`, so `getDb()` is tenant-bound). The job holds the thought id only; the audit reads
 * the stored capture itself when it runs. Retry and give-up follow the job's own counters: see
 * `runCaptureReviewAudit`.
 */

import type { UserJobQueue } from '$lib/server/db/schema'
import { parseCaptureReviewAuditPayload } from './job'
import { runCaptureReviewAudit } from './run-audit'

export async function processCaptureReviewAuditJob(job: UserJobQueue): Promise<void> {
  const { thoughtId } = parseCaptureReviewAuditPayload(job.payload)
  await runCaptureReviewAudit({
    userId: job.userId,
    thoughtId,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
  })
}
