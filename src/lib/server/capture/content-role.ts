/**
 * Vocabulary of the capture content-role decision (docs/planning/long-text-memory.md, L1–L6)
 * and the split marker persisted on the capture's own thought. Pure — no DB, no LLM — so the
 * decision plane, the split generation, the apply step and the enrich worker share one source.
 */

/** personal = the user's own account · reference = recipe/document/email to someone else · mixed = both. */
export const CONTENT_ROLES = ['personal', 'reference', 'mixed'] as const
export type ContentRole = (typeof CONTENT_ROLES)[number]

export function isContentRole(value: unknown): value is ContentRole {
  return typeof value === 'string' && (CONTENT_ROLES as readonly string[]).includes(value)
}

/** Hard bound on one capture's fan-out: beyond this the generation answer is a contract violation. */
export const SPLIT_FANOUT_MAX = 10

/**
 * What a content-role split decided, persisted BEFORE anything is created so a retried
 * enrich resumes the same plan instead of re-deciding (and duplicating notes/children).
 * Stored as `metadata.captureContentSplit` on the capture's own thought.
 */
export type CaptureSplitPlan = {
  role: ContentRole
  rationale: string
  /** personal/mixed: the verbatim spans in text order. `spans[0]` stays on the capture's own thought. reference: []. */
  spans: string[]
  /** Thought id per span, index-aligned with `spans`; `[0]` is the capture's own thought, null until a child exists. */
  spanThoughtIds: Array<string | null>
  /** mixed/reference: the note still to be created; null once created (or when none). */
  note: { title: string; body: string } | null
  attachedFileId: string | null
}

export type CaptureSplitState =
  /** Nothing decided yet: Jev (or the role judge) decides, then the split is applied. */
  | { phase: 'undecided' }
  /** A span child (`metadata.splitFrom`): its text IS the span — never decided or split again. */
  | { phase: 'span_child' }
  /** An earlier enrich attempt already persisted a plan — resume it. */
  | { phase: 'applied'; plan: CaptureSplitPlan }
  /** Marker written before the three-role vocabulary (mode thought_only | split): the split already ran. */
  | { phase: 'legacy_applied'; attachedFileId: string | null }

function fail(field: string, detail: string): never {
  throw new Error(`captureContentSplit marker is malformed: ${field} ${detail}`)
}

function parsePlan(marker: Record<string, unknown>): CaptureSplitPlan {
  const { role, rationale } = marker
  if (!isContentRole(role)) fail('role', `is not one of ${CONTENT_ROLES.join(' | ')}`)
  if (typeof rationale !== 'string') fail('rationale', 'must be a string')
  const { spans } = marker
  if (!Array.isArray(spans) || spans.some((s) => typeof s !== 'string')) {
    fail('spans', 'must be an array of strings')
  }
  const { spanThoughtIds } = marker
  if (
    !Array.isArray(spanThoughtIds) ||
    spanThoughtIds.length !== spans.length ||
    spanThoughtIds.some((id) => id !== null && typeof id !== 'string')
  ) {
    fail('spanThoughtIds', 'must be an array of string|null aligned with spans')
  }
  const { attachedFileId } = marker
  if (attachedFileId !== null && typeof attachedFileId !== 'string') {
    fail('attachedFileId', 'must be a string or null')
  }
  const note = marker.note
  if (note !== null) {
    const n = note as { title?: unknown; body?: unknown } | undefined
    if (!n || typeof n.title !== 'string' || typeof n.body !== 'string') {
      fail('note', 'must be {title, body} or null')
    }
  }
  return {
    role,
    rationale,
    spans: spans as string[],
    spanThoughtIds: spanThoughtIds as Array<string | null>,
    note: note as CaptureSplitPlan['note'],
    attachedFileId,
  }
}

/** Reads the split state off a capture's decrypted metadata. Malformed markers throw. */
export function readCaptureSplitState(metadata: Record<string, unknown>): CaptureSplitState {
  if (metadata.splitFrom) return { phase: 'span_child' }
  const marker = metadata.captureContentSplit
  if (marker === undefined || marker === null) return { phase: 'undecided' }
  if (typeof marker !== 'object') fail('captureContentSplit', 'must be an object')
  const record = marker as Record<string, unknown>
  // pre-L1 markers carried { mode, rationale, attachedFileId } and no role
  if (!('role' in record) && 'mode' in record) {
    return {
      phase: 'legacy_applied',
      attachedFileId: typeof record.attachedFileId === 'string' ? record.attachedFileId : null,
    }
  }
  return { phase: 'applied', plan: parsePlan(record) }
}
