/**
 * The capture review audit for one thought (docs/planning/capture-feedback.md §4, §5):
 * read the stored capture, ask Jev to check what the chat model wrote, and score the review.
 *
 * Failure policy: any failure throws, so the job queue retries (the first try plus exactly 3
 * retries, the ingest policy). On the final attempt the review is first marked `audit_failed` with
 * an explanation drawn from a closed set of sentences (step plus attempt count), so no user text
 * can reach `audit_error`, and the error is rethrown so the queue gives the job up. The thrown
 * error carries the same text-free message; the underlying error stays on `cause` and in the
 * server log.
 */

import { runCaptureAudit } from '$lib/server/llm/decision-plane'
import { loadCaptureAuditInput } from './audit-input'
import { buildCaptureAuditRequest } from './audit-questions'
import { auditPartsFromAnswers } from './audit-result'
import { computeReviewScore, type CaptureReviewPart } from './review-parts'
import {
  completeCaptureReviewAudit,
  failCaptureReviewAudit,
  loadCaptureReviewForAudit,
} from './review-store'

export type AuditStep =
  'reading_capture' | 'decision_model' | 'scoring' | 'saving_result' | 'unexpected'

const STEP_EXPLANATION: Record<AuditStep, string> = {
  reading_capture: 'the stored capture could not be read for the audit',
  decision_model:
    'the decision model call failed, is not configured, or answered outside the question',
  scoring: 'the audit answers could not be turned into a score',
  saving_result: 'the audit result could not be saved',
  unexpected: 'an unexpected error stopped the audit',
}

/** A failed audit attempt. The message is text-free by construction; `cause` has the details. */
export class CaptureAuditError extends Error {
  readonly step: AuditStep
  constructor(step: AuditStep, cause: unknown) {
    super(`Capture review audit failed at step "${step}": ${STEP_EXPLANATION[step]}.`, { cause })
    this.name = 'CaptureAuditError'
    this.step = step
  }
}

async function inStep<T>(step: AuditStep, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw err instanceof CaptureAuditError ? err : new CaptureAuditError(step, err)
  }
}

function causeMessage(err: CaptureAuditError): string {
  return err.cause instanceof Error ? err.cause.message : String(err.cause)
}

async function audit(
  input: { userId: string; thoughtId: string },
  state: { expectedParts?: CaptureReviewPart[] },
): Promise<void> {
  const { userId, thoughtId } = input

  const review = await inStep('reading_capture', () => loadCaptureReviewForAudit(thoughtId))
  if (review && review.status !== 'pending_audit') {
    // A duplicate job, or a review a newer job already settled: nothing left to audit.
    console.info('[capture-review] audit skipped, review is not pending', {
      thoughtId,
      status: review.status,
    })
    return
  }
  state.expectedParts = review?.parts

  const auditInput = await inStep('reading_capture', () =>
    loadCaptureAuditInput({ userId, thoughtId }),
  )
  if (!auditInput) {
    // The thought was deleted; the review cascaded with it.
    console.info('[capture-review] audit skipped, thought no longer exists', { thoughtId })
    return
  }
  if (!review) {
    throw new CaptureAuditError(
      'reading_capture',
      new Error('the thought exists but its capture review is missing'),
    )
  }

  const request = await inStep('reading_capture', () => buildCaptureAuditRequest(auditInput))
  const answers = await inStep('decision_model', () => runCaptureAudit({ userId, request }))
  const auditParts = await inStep('scoring', () => auditPartsFromAnswers(request, answers))

  // The decision parts are the ones enrichment recorded; the audit adds its own beside them.
  const parts = [...review.parts.filter((p) => p.engine === 'jev_decision'), ...auditParts]
  const score = computeReviewScore(parts)
  if (score === null) {
    throw new CaptureAuditError('scoring', new Error('the review has no scored parts'))
  }

  const applied = await inStep('saving_result', () =>
    completeCaptureReviewAudit({ thoughtId, expectedParts: review.parts, parts, score }),
  )
  if (!applied) {
    console.info('[capture-review] audit result dropped, a newer enrichment replaced the review', {
      thoughtId,
    })
  }
}

/**
 * Audits one thought. `attempt` and `maxAttempts` are the job's own counters (every try counts,
 * including the first): on the last one a failure also marks the review `audit_failed`.
 */
export async function runCaptureReviewAudit(input: {
  userId: string
  thoughtId: string
  attempt: number
  maxAttempts: number
}): Promise<void> {
  const state: { expectedParts?: CaptureReviewPart[] } = {}
  try {
    await audit(input, state)
  } catch (err) {
    const failure =
      err instanceof CaptureAuditError ? err : new CaptureAuditError('unexpected', err)
    console.error('[capture-review] audit attempt failed', {
      thoughtId: input.thoughtId,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      step: failure.step,
      message: causeMessage(failure),
    })
    if (input.attempt >= input.maxAttempts) {
      try {
        await failCaptureReviewAudit({
          thoughtId: input.thoughtId,
          auditError: `Audit given up after ${input.attempt} attempts at step "${failure.step}": ${STEP_EXPLANATION[failure.step]}.`,
          expectedParts: state.expectedParts,
        })
      } catch (markErr) {
        // The original failure is what the queue must see; this one is logged loudly beside it.
        console.error('[capture-review] could not mark the audit failed', {
          thoughtId: input.thoughtId,
          message: markErr instanceof Error ? markErr.message : String(markErr),
        })
      }
    }
    throw failure
  }
}
