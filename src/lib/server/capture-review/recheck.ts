/**
 * The re-check after a 👎 reason (docs/planning/capture-feedback.md, C5 follow-up).
 *
 * A 👎 reason is a complaint about what Eigen stored, not an instruction to rewrite the thought, so
 * for a reason Jev labelled as being about stored data the text is never edited: the thought is read
 * again with the owner's correction as prompt context (the edit path only touches stored data when the
 * text changes, which is exactly what must not happen here):
 * - dates, names, links, category: `reenrichThought` with `ownerCorrection`, inside the decision
 *   recorder like the queued enrichment, then `recordCaptureReview` rebuilds the review (parts
 *   reset, new audit queued);
 * - `split_wrong`: the split of the capture is redone (`redoCaptureSplit`), and the parent's
 *   review is queued for a new audit.
 *
 * `snapshotStoredData` is what makes "did anything change" a comparison of persisted structure
 * (text, status, category, names, dates, pieces, the split family), not a judgment of meaning.
 *
 * The correction is LLM context only: never stored, and only its length may reach a log.
 */

import type { CaptureReasonKind } from './reason-question'
import { and, eq } from 'drizzle-orm'
import { reenrichThought } from '$lib/server/capture/enrich'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { runIngestWithRetries } from '$lib/server/ingest/retry'
import { enqueueUserJob } from '$lib/server/job-queue/enqueue'
import { readSplitFamily, redoCaptureSplit } from '$lib/server/memory/split-multi-task'
import { loadCaptureAuditInput } from './audit-input'
import { withDecisionRecorder, type RecordedDecision } from './decision-recorder'
import { CAPTURE_REVIEW_AUDIT_JOB, CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS } from './job'
import { isRecheckReasonKind } from './recheck-kinds'
import { recordCaptureReview } from './record-review'
import { loadCaptureReviewForAudit, resetCaptureReviewToPending } from './review-store'

/**
 * Everything a vote's edit or re-check can change about a thought, as one canonical string: text,
 * stored text, category, lifecycle status, the audit input's names, dates and pieces, and (for a
 * split capture) the pieces and the children with their lifecycle status.
 */
export async function snapshotStoredData(input: {
  userId: string
  thoughtId: string
}): Promise<string> {
  const { userId, thoughtId } = input
  const audit = await loadCaptureAuditInput({ userId, thoughtId })
  if (!audit) throw new Error('[capture-review] snapshot: the thought does not exist')
  const [row] = await getDb()
    .select({ category: thought.category, lifecycleStatus: thought.lifecycleStatus })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) throw new Error('[capture-review] snapshot: the thought does not exist')
  const family = await readSplitFamily({ userId, thoughtId })
  return JSON.stringify({
    rawText: audit.rawText,
    storedText: audit.storedText,
    category: row.category,
    lifecycle: row.lifecycleStatus,
    names: audit.names.map((n) => n.surface).sort(),
    // the day and the clock detail, not the event's label: a re-read may word the label differently
    dates: audit.dates.map((d) => [d.day, d.detail]),
    pieces: audit.pieces.map((p) => p.text),
    family:
      family === null
        ? null
        : {
            parentId: family.parentId,
            pieces: family.pieces,
            children: family.children.map((c) => `${c.id}:${c.lifecycleStatus}`).sort(),
          },
  })
}

async function storedNormalizedText(userId: string, thoughtId: string): Promise<string> {
  const [row] = await getDb()
    .select({
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
    .limit(1)
  if (!row) throw new Error('[capture-review] re-check: the thought does not exist')
  return row.normalizedTextEncrypted
    ? decryptTenantValue({
        userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: row.normalizedTextEncrypted,
      })
    : row.normalizedText
}

/**
 * Whole-capture decisions that `reenrichThought` does not make again. Their earlier parts carry
 * over, so rebuilding the review does not lose the category Jev decided at capture.
 */
async function carriedDecisions(thoughtId: string): Promise<RecordedDecision[]> {
  const review = await loadCaptureReviewForAudit(thoughtId)
  if (!review) return []
  return review.parts
    .filter(
      (p) => p.engine === 'jev_decision' && (p.part === 'category' || p.part === 'content_role'),
    )
    .map((p) => ({
      kind: p.part as RecordedDecision['kind'],
      ref: p.ref,
      choice: p.label,
      probability: p.probability,
    }))
}

async function recheckByReenrich(input: {
  userId: string
  thoughtId: string
  correction: string
}): Promise<void> {
  const { userId, thoughtId, correction } = input
  const normalizedText = await storedNormalizedText(userId, thoughtId)
  const carried = await carriedDecisions(thoughtId)
  let decisions: RecordedDecision[] = []
  await runIngestWithRetries(async () => {
    decisions = (
      await withDecisionRecorder(() =>
        reenrichThought(userId, thoughtId, normalizedText, { ownerCorrection: correction }),
      )
    ).decisions
  })
  const decidedKinds = new Set(decisions.map((d) => d.kind))
  await runIngestWithRetries(() =>
    recordCaptureReview({
      userId,
      thoughtId,
      decisions: [...carried.filter((d) => !decidedKinds.has(d.kind)), ...decisions],
    }),
  )
}

async function recheckBySplit(input: {
  userId: string
  thoughtId: string
  correction: string
}): Promise<void> {
  const { userId, thoughtId, correction } = input
  // the judge call runs inside the ingest ladder inside redoCaptureSplit; nothing changes before it answers
  const redone = await redoCaptureSplit({ userId, thoughtId, ownerCorrection: correction })
  // The parent's pieces changed: its stored parts stay, its audit runs again.
  if (await resetCaptureReviewToPending(redone.parentId)) {
    const queued = await enqueueUserJob({
      userId,
      jobType: CAPTURE_REVIEW_AUDIT_JOB,
      runAfter: new Date(),
      payload: { thoughtId: redone.parentId },
      maxAttempts: CAPTURE_REVIEW_AUDIT_MAX_ATTEMPTS,
    })
    if (!queued.enqueued) {
      throw new Error(
        `[capture-review] ${CAPTURE_REVIEW_AUDIT_JOB} job was not enqueued (${queued.reason})`,
      )
    }
  }
}

/**
 * Reads the thought again with the owner's correction. Throws when the re-check fails after the
 * ingest ladder (the first try and exactly 3 retries); the caller reports it, nothing is hidden.
 */
export async function recheckStoredData(input: {
  userId: string
  thoughtId: string
  reasonKind: CaptureReasonKind
  correction: string
}): Promise<void> {
  if (!isRecheckReasonKind(input.reasonKind)) {
    throw new Error(`[capture-review] no re-check for reason kind "${input.reasonKind}"`)
  }
  console.info('[capture-review] re-check start', {
    userId: input.userId,
    thoughtId: input.thoughtId,
    reasonKind: input.reasonKind,
    correctionChars: input.correction.length,
  })
  const args = {
    userId: input.userId,
    thoughtId: input.thoughtId,
    correction: input.correction,
  }
  if (input.reasonKind === 'split_wrong') await recheckBySplit(args)
  else await recheckByReenrich(args)
}
