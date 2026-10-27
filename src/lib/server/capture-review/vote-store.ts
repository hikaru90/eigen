/**
 * Persistence for the owner's vote on a capture (docs/planning/capture-feedback.md §6). Runs on the
 * tenant-bound `getDb()` (RLS by user_id) and also filters by user id.
 *
 * It writes only the vote columns of `capture_review` (verdict, voted_at, voted_on, reason_encrypted,
 * reason_kind, edit_applied_at). The audit columns (parts, score, status) belong to the audit and
 * enrichment (`review-store.ts`), which leaves these columns alone in turn.
 *
 * Reads for the Mesh lists return the verdict only: never the reason, its kind or the parts.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import {
  captureReview,
  thought,
  type CaptureReviewVerdict,
  type CaptureReviewVotedOn,
} from '$lib/server/db/schema'

function requireId(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`[capture-review] ${field} must not be empty`)
}

/** What a vote needs to know about its thought. */
export type VoteTarget = { category: string }

/** The thought a vote is for, or null when it does not exist for this user (deleted, or not theirs). */
export async function loadVoteTarget(input: {
  userId: string
  thoughtId: string
}): Promise<VoteTarget | null> {
  requireId(input.userId, 'userId')
  requireId(input.thoughtId, 'thoughtId')
  const [row] = await getDb()
    .select({ category: thought.category })
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)
  return row ?? null
}

/**
 * Gives a thought that has no review yet (captured before the review existed, or still enriching)
 * an empty `pending_audit` one, and returns its id. Returns null, writing nothing, when a review
 * already exists: enrichment's parts and the audit's score are never overwritten here, and an
 * enrichment that finishes later replaces the empty parts through its own upsert.
 */
export async function createPendingCaptureReviewIfMissing(input: {
  userId: string
  thoughtId: string
}): Promise<string | null> {
  requireId(input.userId, 'userId')
  requireId(input.thoughtId, 'thoughtId')
  const now = new Date()
  const [row] = await getDb()
    .insert(captureReview)
    .values({
      userId: input.userId,
      thoughtId: input.thoughtId,
      parts: [],
      score: null,
      status: 'pending_audit',
      auditError: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: captureReview.thoughtId })
    .returning({ id: captureReview.id })
  return row?.id ?? null
}

/** Removes a review this module just created (its audit job could not be queued). */
export async function deleteCaptureReview(input: {
  userId: string
  reviewId: string
}): Promise<void> {
  requireId(input.userId, 'userId')
  requireId(input.reviewId, 'reviewId')
  await getDb()
    .delete(captureReview)
    .where(and(eq(captureReview.id, input.reviewId), eq(captureReview.userId, input.userId)))
}

export type CaptureVoteRecord = {
  userId: string
  thoughtId: string
  verdict: CaptureReviewVerdict
  votedOn: CaptureReviewVotedOn
  /** Tenant-encrypted reason, or null to clear it. */
  reasonEncrypted: string | null
  /** The closed label of the mistake, or null to clear it. */
  reasonKind: string | null
  /**
   * When the reason was applied as an edit; null clears it (the edit failed). Left out, the stored
   * value stays as it is (a vote without a reason applies nothing).
   */
  editAppliedAt?: Date | null
}

/**
 * Stores the vote on the thought's review, replacing the previous one (one vote per thought).
 * Fails loudly when there is no review to write to.
 */
export async function saveCaptureVote(vote: CaptureVoteRecord): Promise<void> {
  requireId(vote.userId, 'userId')
  requireId(vote.thoughtId, 'thoughtId')
  const now = new Date()
  const rows = await getDb()
    .update(captureReview)
    .set({
      verdict: vote.verdict,
      votedAt: now,
      votedOn: vote.votedOn,
      reasonEncrypted: vote.reasonEncrypted,
      reasonKind: vote.reasonKind,
      ...(vote.editAppliedAt === undefined ? {} : { editAppliedAt: vote.editAppliedAt }),
      updatedAt: now,
    })
    .where(and(eq(captureReview.thoughtId, vote.thoughtId), eq(captureReview.userId, vote.userId)))
    .returning({ id: captureReview.id })
  if (rows.length === 0) {
    throw new Error('[capture-review] no capture review to store the vote on')
  }
}

/** The current verdict of each voted-on thought among `thoughtIds`; thoughts never voted on are absent. */
export async function loadCaptureVerdicts(
  userId: string,
  thoughtIds: string[],
): Promise<Map<string, CaptureReviewVerdict>> {
  requireId(userId, 'userId')
  const verdicts = new Map<string, CaptureReviewVerdict>()
  if (thoughtIds.length === 0) return verdicts
  const rows = await getDb()
    .select({ thoughtId: captureReview.thoughtId, verdict: captureReview.verdict })
    .from(captureReview)
    .where(
      and(
        eq(captureReview.userId, userId),
        inArray(captureReview.thoughtId, thoughtIds),
        isNotNull(captureReview.verdict),
      ),
    )
  for (const row of rows) {
    if (row.verdict !== null) verdicts.set(row.thoughtId, row.verdict)
  }
  return verdicts
}
