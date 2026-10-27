/**
 * The owner's vote on a stored thought (docs/planning/capture-feedback.md §6), from the two places
 * that offer it: the strip right after Capture and the unfolded Mesh row. Eigen never asks; this
 * runs only when the owner presses 👍 or 👎, or when the owner's agent rates a capture over MCP
 * (`rate_capture`, place `mcp`, which is stored as no place).
 *
 * - 👍: the verdict, nothing else.
 * - 👎 with no text: the verdict, nothing else. No edit, no label.
 * - 👎 with a reason: Jev labels the kind of mistake (closed set, the only thing ever aggregated),
 *   the reason is applied as an edit through the existing natural-language edit, and verdict,
 *   encrypted reason, label and the edit time are stored (a `split_wrong` reason skips the edit and
 *   redoes the split). When the edit changed nothing (the text
 *   already said the right thing) and the label is about stored data, the thought is read again with
 *   the owner's correction (`recheck.ts`). `edit_applied_at` is set only when a snapshot of the
 *   stored data after the edit / re-check differs from the one before it (`changed`). If the label cannot be made (the ingest
 *   ladder: the first try and exactly 3 retries) NOTHING is stored and the call throws, so the UI
 *   keeps the text and the owner can send again. If only the edit fails, the vote is stored anyway
 *   and the edit error is returned to the caller, never swallowed.
 * - One vote per thought: voting again replaces the previous one.
 *
 * A thought with no review row (captured before the review existed, or still enriching) gets an
 * empty `pending_audit` review and its audit job queued, the same job and attempts as enrichment
 * queues; there is no back-fill.
 *
 * Logs carry ids, the verdict and the closed kind only: never the reason, the capture or any name.
 */

import type { CaptureSubmitResult } from '$lib/capture/capture-result-types'
import { editStoredThought } from '$lib/server/capture/service'
import { encryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import type { CaptureReviewVerdict } from '$lib/server/db/schema'
import { isRetryExhaustedError, runIngestWithRetries } from '$lib/server/ingest/retry'
import { enqueueUserJob } from '$lib/server/job-queue/enqueue'
import { runCaptureReasonLabel } from '$lib/server/llm/decision-plane'
import { loadCaptureAuditInput } from './audit-input'
import { CAPTURE_REVIEW_AUDIT_JOB, CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS } from './job'
import {
  buildCaptureReasonRequest,
  CAPTURE_REASON_KINDS,
  type CaptureReasonKind,
} from './reason-question'
import { recheckStoredData, snapshotStoredData } from './recheck'
import { isRecheckReasonKind } from './recheck-kinds'
import { buildStoredSummary } from './stored-summary'
import { CaptureVoteError } from './vote-error'
import { validateCaptureVote, type CaptureVotePlace } from './vote-input'
import {
  createPendingCaptureReviewIfMissing,
  deleteCaptureReview,
  loadVoteTarget,
  saveCaptureVote,
} from './vote-store'

export { CaptureVoteError }

export type VoteOnCaptureInput = {
  userId: string
  thoughtId: string
  verdict: CaptureReviewVerdict
  /** Only with a thumbs-down. Trimmed by the contract; empty means no reason. */
  reason?: string
  /** `capture` and `mesh` are the two app places; `mcp` is an agent over MCP (stored as no place). */
  place: CaptureVotePlace
}

export type VoteOnCaptureResult = {
  verdict: CaptureReviewVerdict
  /** The closed label of the mistake; null without a reason. */
  reasonKind: CaptureReasonKind | null
  /**
   * True when the reason changed what is stored (the edit or the re-check): `edit_applied_at` is
   * set exactly then. A reason that changed nothing is stored as a vote and nothing more.
   */
  editApplied: boolean
  /** The same fact under the name the UI and agents use: something in the stored data changed. */
  changed: boolean
  /** Why the edit or the re-check failed, when a reason was given and it did not go through. */
  editError: string | null
  /** The thought as the edit left it, when an edit ran. */
  thought: CaptureSubmitResult | null
}

const NOT_FOUND = 'Thought not found'

function notFound(): CaptureVoteError {
  return new CaptureVoteError('not_found', NOT_FOUND)
}

function isCaptureReasonKind(value: unknown): value is CaptureReasonKind {
  return (CAPTURE_REASON_KINDS as readonly unknown[]).includes(value)
}

/** The kind of mistake the reason describes, inside the ingest ladder; nothing is stored on failure. */
async function labelReason(input: {
  userId: string
  rawText: string
  storedSummary: string
  reason: string
}): Promise<CaptureReasonKind> {
  const request = buildCaptureReasonRequest({
    rawText: input.rawText,
    storedSummary: input.storedSummary,
    reason: input.reason,
  })
  try {
    return await runIngestWithRetries(async () => {
      const label = await runCaptureReasonLabel({ userId: input.userId, request })
      if (!isCaptureReasonKind(label.kind)) {
        throw new Error('the label is not one of the capture reason kinds')
      }
      return label.kind
    })
  } catch (err) {
    const tries = isRetryExhaustedError(err) ? err.attempts : 1
    console.error('[capture-review] reason label failed', {
      userId: input.userId,
      tries,
      errorName: err instanceof Error ? err.name : typeof err,
    })
    throw new CaptureVoteError(
      'label_failed',
      `Eigen could not work out what kind of mistake you described after ${tries} ${tries === 1 ? 'try' : 'tries'}, so nothing was saved. Send it again.`,
      { cause: err },
    )
  }
}

/**
 * A thought with no review gets an empty pending one and its audit job queued. If the job cannot
 * be queued the review it just created is removed again, so a retry finds the thought as it was
 * and queues both.
 */
async function ensureCaptureReview(userId: string, thoughtId: string): Promise<void> {
  const created = await createPendingCaptureReviewIfMissing({ userId, thoughtId })
  if (created === null) return
  try {
    const queued = await enqueueUserJob({
      userId,
      jobType: CAPTURE_REVIEW_AUDIT_JOB,
      runAfter: new Date(),
      payload: { thoughtId },
      maxAttempts: CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS,
    })
    if (!queued.enqueued) {
      throw new Error(
        `[capture-review] ${CAPTURE_REVIEW_AUDIT_JOB} job was not enqueued (${queued.reason})`,
      )
    }
  } catch (err) {
    try {
      await deleteCaptureReview({ userId, reviewId: created })
    } catch (cleanupErr) {
      // The original failure is what the caller must see; this one is logged loudly beside it.
      console.error('[capture-review] could not remove the review after its audit was not queued', {
        thoughtId,
        errorName: cleanupErr instanceof Error ? cleanupErr.name : typeof cleanupErr,
      })
    }
    throw err
  }
}

type EditOutcome =
  { applied: true; thought: CaptureSubmitResult } | { applied: false; error: string }

/** Applies the reason through the existing natural-language edit. A failure is reported, not thrown. */
async function applyReasonAsEdit(
  userId: string,
  thoughtId: string,
  reason: string,
): Promise<EditOutcome> {
  let result: Awaited<ReturnType<typeof editStoredThought>>
  try {
    result = await editStoredThought(userId, thoughtId, reason)
  } catch (err) {
    console.error('[capture-review] reason edit failed', {
      userId,
      thoughtId,
      errorName: err instanceof Error ? err.name : typeof err,
    })
    return { applied: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!result.ok) throw notFound()
  return { applied: true, thought: result.thought }
}

export async function voteOnCapture(input: VoteOnCaptureInput): Promise<VoteOnCaptureResult> {
  const vote = validateCaptureVote(input)
  const { userId } = input
  const { thoughtId, verdict, place, reason } = vote

  const target = await loadVoteTarget({ userId, thoughtId })
  if (!target) throw notFound()

  if (reason === undefined) {
    // 👍, or 👎 with no text: the verdict only. No label, no edit.
    await ensureCaptureReview(userId, thoughtId)
    await saveCaptureVote({
      userId,
      thoughtId,
      verdict,
      place,
      reasonEncrypted: null,
      reasonKind: null,
    })
    console.info('[capture-review] vote stored', { userId, thoughtId, verdict, place })
    return {
      verdict,
      reasonKind: null,
      editApplied: false,
      changed: false,
      editError: null,
      thought: null,
    }
  }

  // 👎 with a reason. What Eigen stored NOW is read before the edit changes it.
  const audit = await loadCaptureAuditInput({ userId, thoughtId })
  if (!audit) throw notFound()
  const storedSummary = buildStoredSummary({ category: target.category, audit })

  // Jev's label first: if it cannot be made nothing is stored and nothing is edited.
  const reasonKind = await labelReason({
    userId,
    rawText: audit.rawText,
    storedSummary,
    reason,
  })
  const reasonEncrypted = await encryptTenantValue({
    userId,
    table: 'capture_review',
    column: 'reason',
    plaintext: reason,
  })
  await ensureCaptureReview(userId, thoughtId)

  const snapshotBefore = await snapshotStoredData({ userId, thoughtId })
  // A reason about the SPLIT is not an edit of this thought's words (the vote may be on one child
  // of the split, and rewriting that child would only corrupt it): the split is redone instead.
  const edit: EditOutcome | null =
    reasonKind === 'split_wrong' ? null : await applyReasonAsEdit(userId, thoughtId, reason)

  let editError: string | null = edit === null || edit.applied ? null : edit.error
  let snapshotAfter = snapshotBefore
  if (edit === null || edit.applied) {
    snapshotAfter = edit === null ? snapshotBefore : await snapshotStoredData({ userId, thoughtId })
    // The edit changed neither text nor status nor any stored data, and the reason is about stored
    // data: read the thought again with the owner's correction.
    if (snapshotAfter === snapshotBefore && isRecheckReasonKind(reasonKind)) {
      try {
        await recheckStoredData({ userId, thoughtId, reasonKind, correction: reason })
        snapshotAfter = await snapshotStoredData({ userId, thoughtId })
      } catch (err) {
        console.error('[capture-review] re-check failed', {
          userId,
          thoughtId,
          reasonKind,
          errorName: err instanceof Error ? err.name : typeof err,
        })
        editError = `Eigen could not read the capture again with your correction: ${
          err instanceof Error ? err.message : String(err)
        }`
      }
    }
  }
  const changed = editError === null && snapshotAfter !== snapshotBefore

  await saveCaptureVote({
    userId,
    thoughtId,
    verdict,
    place,
    reasonEncrypted,
    reasonKind,
    editAppliedAt: changed ? new Date() : null,
  })
  console.info('[capture-review] vote stored', {
    userId,
    thoughtId,
    verdict,
    place,
    reasonKind,
    changed,
  })
  return {
    verdict,
    reasonKind,
    editApplied: changed,
    changed,
    editError,
    thought: changed && edit?.applied ? edit.thought : null,
  }
}
