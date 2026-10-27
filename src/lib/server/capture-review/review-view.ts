/**
 * A capture review as an agent reads it (`get_capture_review`, docs/planning/capture-feedback.md
 * §7): the status, the score against the threshold, every part in plain words, the vote.
 *
 * Built deterministically from what is stored NOW, with no model. A part says what it is about by
 * looking its ref up in the thought's current audit input (`loadCaptureAuditInput`), the same
 * persisted structure the audit and the 👎 stored summary read: a name's surface, a date's event
 * and its time in the date question's own words, a piece's text, the thought's category key.
 * Nothing is matched against the capture's text. A part that describes the whole capture (wording,
 * missing names or dates, pieces cover, content role) or a hidden decision (entity type, kind of
 * time: their refs index the enrichment's mentions and times, which are not stored) has no `about`.
 *
 * Never carries the 👎 reason (text or ciphertext), an embedding, or another user's data: the
 * loader selects none of them and the view has no field for them.
 */

import type { CaptureAuditInput } from './audit-questions'
import type { CaptureReviewPart } from './review-parts'
import type { CaptureReviewSnapshot } from './review-store'
import type { CaptureReviewStatus, CaptureReviewVerdict } from '$lib/server/db/schema'
import { loadCaptureAuditInput } from './audit-input'
import {
  auditDateQuestionId,
  auditNameQuestionId,
  auditPieceQuestionId,
  describeStoredDatePhrases,
} from './audit-questions'
import { CAPTURE_REVIEW_THRESHOLD, SCORED_PARTS } from './review-parts'
import { loadCaptureReviewSnapshot } from './review-store'
import { CaptureVoteError } from './vote-error'

export type CaptureReviewPartView = {
  part: string
  ref: string
  label: string
  probability: number
  /** True for the parts the score is the lowest of (`SCORED_PARTS`). */
  counts_toward_score: boolean
  /** Plain words for what the part refers to now, or null for a whole-capture or hidden part. */
  about: string | null
}

export type CaptureReviewVoteView = {
  verdict: CaptureReviewVerdict
  /** `capture` or `mesh` for a vote in the app; null for a vote cast by an agent over MCP. */
  voted_on: 'capture' | 'mesh' | null
  reason_kind: string | null
  /** True when a reason was applied as an edit to the thought. */
  edit_applied: boolean
}

export type CaptureReviewView = {
  thought_id: string
  status: 'none' | CaptureReviewStatus
  score: number | null
  threshold: number
  /** Null when there is no score. A score at the threshold is not below it. */
  below_threshold: boolean | null
  parts: CaptureReviewPartView[]
  vote: CaptureReviewVoteView | null
  /** A plain-English explanation when the review is none, unfinished or failed, or may be out of date. */
  note: string | null
}

const scoredPartSet: ReadonlySet<string> = new Set(SCORED_PARTS)

const NOTE_NONE =
  'Not reviewed yet — enrichment is still running, or the thought was captured before capture reviews existed. Rating it with rate_capture starts its review.'
const NOTE_PENDING =
  'The audit has not finished, so there is no score yet and the audited parts (wording, names, dates, pieces) are not listed. Read this again in a moment.'
const NOTE_ARCHIVED =
  'The thought is archived (delete_thought archives it); an archived thought keeps its review.'
const NOTE_EDITED = 'The parts describe the capture before its latest edit.'

/** `auditError` is one of the audit's closed sentences (no user text) and ends with a full stop. */
function failedNote(auditError: string | null): string {
  const gaveUp = 'The audit gave up, so there is no score'
  const why = auditError === null ? `${gaveUp}.` : `${gaveUp}: ${auditError}`
  return `${why} The thought itself is stored as it is.`
}

/** Whether the part's `about` needs the thought's names, dates or pieces (and so the audit input). */
function needsAuditInput(part: CaptureReviewPart): boolean {
  return part.part === 'name' || part.part === 'date' || part.part === 'piece'
}

/** What a part is about, in plain words, from the thought as it is stored now. */
function aboutOf(
  part: CaptureReviewPart,
  category: string,
  audit: CaptureAuditInput | null,
): string | null {
  if (part.part === 'category') return category
  if (audit === null) return null
  switch (part.part) {
    case 'name':
      return audit.names.find((n) => auditNameQuestionId(n.ref) === part.ref)?.surface ?? null
    case 'date': {
      const date = describeStoredDatePhrases(audit).find(
        (d) => auditDateQuestionId(d.ref) === part.ref,
      )
      return date === undefined ? null : `"${date.event}" — ${date.when}`
    }
    case 'piece':
      return audit.pieces.find((p) => auditPieceQuestionId(p.ref) === part.ref)?.text ?? null
    default:
      return null
  }
}

/**
 * The view of one thought's review. `audit` is the thought's current audit input; it is only read
 * for the parts that name a name, a date or a piece, so it may be null when there are none.
 */
export function buildCaptureReviewView(input: {
  thoughtId: string
  snapshot: CaptureReviewSnapshot
  audit: CaptureAuditInput | null
}): CaptureReviewView {
  const { snapshot, audit } = input
  const { review } = snapshot

  const notes: string[] = []
  if (review === null) notes.push(NOTE_NONE)
  else if (review.status === 'pending_audit') notes.push(NOTE_PENDING)
  else if (review.status === 'audit_failed') notes.push(failedNote(review.auditError))
  // updated_at is the last write of the audit columns, so an edit after it came after the parts did
  if (
    review !== null &&
    review.editAppliedAt !== null &&
    review.editAppliedAt.getTime() > review.updatedAt.getTime()
  ) {
    notes.push(NOTE_EDITED)
  }
  if (snapshot.lifecycleStatus === 'archived') notes.push(NOTE_ARCHIVED)

  const score = review?.score ?? null
  return {
    thought_id: input.thoughtId,
    status: review === null ? 'none' : review.status,
    score,
    threshold: CAPTURE_REVIEW_THRESHOLD,
    below_threshold: score === null ? null : score < CAPTURE_REVIEW_THRESHOLD,
    parts: (review?.parts ?? []).map((part) => ({
      part: part.part,
      ref: part.ref,
      label: part.label,
      probability: part.probability,
      counts_toward_score: scoredPartSet.has(part.part),
      about: aboutOf(part, snapshot.category, audit),
    })),
    vote:
      review === null || review.verdict === null
        ? null
        : {
            verdict: review.verdict,
            voted_on: review.votedOn,
            reason_kind: review.reasonKind,
            edit_applied: review.editAppliedAt !== null,
          },
    note: notes.length === 0 ? null : notes.join(' '),
  }
}

/** The review of the user's thought, read now. A thought that is not there is a `not_found` error. */
export async function getCaptureReviewView(input: {
  userId: string
  thoughtId: string
}): Promise<CaptureReviewView> {
  const snapshot = await loadCaptureReviewSnapshot(input)
  if (snapshot === null) throw new CaptureVoteError('not_found', 'Thought not found')

  let audit: CaptureAuditInput | null = null
  if (snapshot.review?.parts.some(needsAuditInput)) {
    audit = await loadCaptureAuditInput(input)
    if (audit === null) throw new CaptureVoteError('not_found', 'Thought not found')
  }
  return buildCaptureReviewView({ thoughtId: input.thoughtId, snapshot, audit })
}
