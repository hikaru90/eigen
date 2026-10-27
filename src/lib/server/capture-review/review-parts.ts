/**
 * The parts of a capture review (docs/planning/capture-feedback.md §2, §5).
 *
 * A part is one thing Eigen decided or wrote for a capture, with how sure Jev is about it:
 * - `jev_decision`: Jev decided it (category, name type, kind of time). `probability` is Jev's
 *   probability of the answer it chose.
 * - `jev_audit`: the chat model wrote it and Jev checked it (wording, names, dates, split pieces).
 *   `probability` is Jev's probability that it is right, so low means "probably wrong".
 *
 * A part holds NO user text. `ref` is a decision item ref (`m1`, `t2`) or an audit question id
 * (`name:n1`, `date:d1`, `wording`, `missing_names`, `piece:p1`, `pieces_cover`); `label` is a
 * closed value (an ontology key or a criteria key). The schema is strict so a surface, an event
 * text or a piece text cannot ride along; it validates on write and on read.
 */

import type { RecordedDecision } from './decision-recorder'
import { z } from 'zod'

/**
 * The Jev decisions a capture review scores: the user-visible capture decisions. Anything else the
 * recorder collected (open_loop, salience_band, relation and duration kinds, ...) is ignored.
 */
export const REVIEW_DECISION_KINDS = [
  'category',
  'content_role',
  'entity_type',
  'temporal_kind',
] as const
export type ReviewDecisionKind = (typeof REVIEW_DECISION_KINDS)[number]

/** The chat-written parts Jev audits, named after their audit question. */
export const REVIEW_AUDIT_PARTS = [
  'wording',
  'name',
  'missing_names',
  'date',
  'piece',
  'pieces_cover',
] as const
export type ReviewAuditPart = (typeof REVIEW_AUDIT_PARTS)[number]

/**
 * A capture whose score is below this is "weak"; at or above it is "sure". A product constant, like
 * FORGET_CONFIDENCE_MIN: it only splits the operator's numbers (C4) into weak and sure captures.
 * The user never sees the score, and nothing asks them about a weak capture. It is recalibrated
 * from the 👍/👎 data once that exists (C5).
 */
export const CAPTURE_REVIEW_THRESHOLD = 0.7

const REVIEW_ENGINES = ['jev_decision', 'jev_audit'] as const

const decisionKindSet: ReadonlySet<string> = new Set(REVIEW_DECISION_KINDS)
const auditPartSet: ReadonlySet<string> = new Set(REVIEW_AUDIT_PARTS)

export const captureReviewPartSchema = z
  .strictObject({
    part: z.enum([...REVIEW_DECISION_KINDS, ...REVIEW_AUDIT_PARTS]),
    ref: z.string().min(1).max(80).regex(/^\S+$/),
    engine: z.enum(REVIEW_ENGINES),
    label: z.string().trim().min(1).max(80),
    probability: z.number().min(0).max(1),
  })
  .refine(
    (p) => (p.engine === 'jev_decision' ? decisionKindSet.has(p.part) : auditPartSet.has(p.part)),
    { message: 'part does not belong to its engine' },
  )

export type CaptureReviewPart = z.infer<typeof captureReviewPartSchema>

const captureReviewPartsSchema = z.array(captureReviewPartSchema)

/**
 * Validates a `parts` value (on write and on read). The error names the failing field paths and
 * rules only, never the offending values.
 */
export function parseCaptureReviewParts(value: unknown): CaptureReviewPart[] {
  const parsed = captureReviewPartsSchema.safeParse(value)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'parts'}: ${issue.message}`)
      .join('; ')
    throw new Error(`[capture-review] invalid capture review parts (${problems})`)
  }
  const seen = new Set<string>()
  for (const part of parsed.data) {
    const key = `${part.part}\u0000${part.ref}`
    if (seen.has(key)) {
      throw new Error(
        `[capture-review] invalid capture review parts (duplicate part ${part.part} ref ${part.ref})`,
      )
    }
    seen.add(key)
  }
  return parsed.data
}

/**
 * The `jev_decision` parts for the decisions one enrichment attempt recorded. Kinds outside
 * REVIEW_DECISION_KINDS are dropped. When the same item was decided twice in an attempt the later
 * answer is the one that was applied, so it replaces the earlier one.
 */
export function decisionsToParts(decisions: RecordedDecision[]): CaptureReviewPart[] {
  const byItem = new Map<string, CaptureReviewPart>()
  for (const d of decisions) {
    if (!decisionKindSet.has(d.kind)) continue
    byItem.set(`${d.kind}\u0000${d.ref}`, {
      part: d.kind as ReviewDecisionKind,
      ref: d.ref,
      engine: 'jev_decision',
      label: d.choice,
      probability: d.probability,
    })
  }
  return [...byItem.values()]
}

/** The weakest link: the lowest probability over all parts. Null when there are no parts. */
export function computeReviewScore(parts: CaptureReviewPart[]): number | null {
  if (parts.length === 0) return null
  return Math.min(...parts.map((p) => p.probability))
}
