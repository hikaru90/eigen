/**
 * Persistence for `capture_review` (docs/planning/capture-feedback.md §2). Runs on the tenant-bound
 * `getDb()` (RLS by user_id). Parts are validated by the strict schema on every write and read, so
 * user text cannot be stored in a review.
 *
 * The vote columns (verdict, voted_at, voted_on, reason_*, edit_applied_at) belong to phase C2
 * (`vote-store.ts`): nothing here ever writes them, and the enrichment upsert leaves them
 * untouched. In turn the vote store never writes parts, score or status. The one read of the whole
 * review (`loadCaptureReviewSnapshot`, for the `get_capture_review` tool) selects the vote's
 * verdict, place, label and edit time, and never the reason in any form.
 */

import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  captureReview,
  thought,
  type CaptureReviewStatus,
  type CaptureReviewVerdict,
  type CaptureReviewVotedOn,
  type LifecycleStatus,
} from '$lib/server/db/schema'
import { parseCaptureReviewParts, type CaptureReviewPart } from './review-parts'

function requireId(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`[capture-review] ${field} must not be empty`)
}

function requireScore(score: number): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error('[capture-review] score must be within 0..1')
  }
}

/**
 * Creates the review for a thought, or resets the existing one for a new enrichment: parts are
 * replaced, the score is cleared, the status goes back to `pending_audit`. Idempotent for
 * enrichment retries and for re-enrichment after an edit. The vote stays as it is.
 */
export async function upsertPendingCaptureReview(input: {
  userId: string
  thoughtId: string
  parts: CaptureReviewPart[]
}): Promise<void> {
  requireId(input.userId, 'userId')
  requireId(input.thoughtId, 'thoughtId')
  const parts = parseCaptureReviewParts(input.parts)
  const now = new Date()
  await getDb()
    .insert(captureReview)
    .values({
      userId: input.userId,
      thoughtId: input.thoughtId,
      parts,
      score: null,
      status: 'pending_audit',
      auditError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: captureReview.thoughtId,
      set: { parts, score: null, status: 'pending_audit', auditError: null, updatedAt: now },
    })
}

export type CaptureReviewForAudit = { status: CaptureReviewStatus; parts: CaptureReviewPart[] }

/** The review the audit job works from, or null when the thought has none. */
export async function loadCaptureReviewForAudit(
  thoughtId: string,
): Promise<CaptureReviewForAudit | null> {
  const [row] = await getDb()
    .select({ status: captureReview.status, parts: captureReview.parts })
    .from(captureReview)
    .where(eq(captureReview.thoughtId, thoughtId))
    .limit(1)
  if (!row) return null
  return { status: row.status, parts: parseCaptureReviewParts(row.parts) }
}

/** Only while the review is still `pending_audit` with the parts the audit started from. */
function pendingWhere(thoughtId: string, expectedParts: CaptureReviewPart[] | undefined) {
  const base = and(
    eq(captureReview.thoughtId, thoughtId),
    eq(captureReview.status, 'pending_audit'),
  )
  if (expectedParts === undefined) return base
  return and(base, sql`${captureReview.parts} = ${JSON.stringify(expectedParts)}::jsonb`)
}

/**
 * Writes the audit result: all parts (decision parts plus audit parts), the score, `scored`.
 * Returns false, writing nothing, when the review is no longer the one the audit started from
 * (a newer enrichment reset it; its own audit job will score it).
 */
export async function completeCaptureReviewAudit(input: {
  thoughtId: string
  expectedParts: CaptureReviewPart[]
  parts: CaptureReviewPart[]
  score: number
}): Promise<boolean> {
  requireId(input.thoughtId, 'thoughtId')
  requireScore(input.score)
  const parts = parseCaptureReviewParts(input.parts)
  const expectedParts = parseCaptureReviewParts(input.expectedParts)
  const rows = await getDb()
    .update(captureReview)
    .set({ parts, score: input.score, status: 'scored', auditError: null, updatedAt: new Date() })
    .where(pendingWhere(input.thoughtId, expectedParts))
    .returning({ id: captureReview.id })
  return rows.length > 0
}

/**
 * Marks the audit as given up, with an explanation that holds no user text. Returns false when the
 * review is no longer pending (or no longer carries `expectedParts`, when given): a newer
 * enrichment owns it then.
 */
export async function failCaptureReviewAudit(input: {
  thoughtId: string
  auditError: string
  expectedParts?: CaptureReviewPart[]
}): Promise<boolean> {
  requireId(input.thoughtId, 'thoughtId')
  requireId(input.auditError, 'auditError')
  const expectedParts =
    input.expectedParts === undefined ? undefined : parseCaptureReviewParts(input.expectedParts)
  const rows = await getDb()
    .update(captureReview)
    .set({ status: 'audit_failed', auditError: input.auditError, updatedAt: new Date() })
    .where(pendingWhere(input.thoughtId, expectedParts))
    .returning({ id: captureReview.id })
  return rows.length > 0
}

/**
 * A thought and its review, for reading (the `get_capture_review` tool). `review` is null for a
 * thought that was never reviewed. The reason is never selected, encrypted or not.
 */
export type CaptureReviewSnapshot = {
  category: string
  lifecycleStatus: LifecycleStatus
  review: {
    status: CaptureReviewStatus
    score: number | null
    parts: CaptureReviewPart[]
    auditError: string | null
    verdict: CaptureReviewVerdict | null
    /** NULL for a vote cast over MCP (see `votedOnColumn`). */
    votedOn: CaptureReviewVotedOn | null
    reasonKind: string | null
    editAppliedAt: Date | null
    /** The last write of the audit columns (a vote leaves it alone). */
    updatedAt: Date
  } | null
}

/**
 * The thought's category and lifecycle with its review, or null when the thought does not exist for
 * this user (deleted, or not theirs). An archived thought keeps its review, so it is read like any
 * other. Stored parts are validated on read.
 */
export async function loadCaptureReviewSnapshot(input: {
  userId: string
  thoughtId: string
}): Promise<CaptureReviewSnapshot | null> {
  requireId(input.userId, 'userId')
  requireId(input.thoughtId, 'thoughtId')
  const db = getDb()

  const [thoughtRow] = await db
    .select({ category: thought.category, lifecycleStatus: thought.lifecycleStatus })
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)
  if (!thoughtRow) return null

  const [row] = await db
    .select({
      status: captureReview.status,
      score: captureReview.score,
      parts: captureReview.parts,
      auditError: captureReview.auditError,
      verdict: captureReview.verdict,
      votedOn: captureReview.votedOn,
      reasonKind: captureReview.reasonKind,
      editAppliedAt: captureReview.editAppliedAt,
      updatedAt: captureReview.updatedAt,
    })
    .from(captureReview)
    .where(
      and(eq(captureReview.thoughtId, input.thoughtId), eq(captureReview.userId, input.userId)),
    )
    .limit(1)

  return {
    category: thoughtRow.category,
    lifecycleStatus: thoughtRow.lifecycleStatus,
    review: row ? { ...row, parts: parseCaptureReviewParts(row.parts) } : null,
  }
}
