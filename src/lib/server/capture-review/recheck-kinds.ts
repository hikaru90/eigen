import type { CaptureReasonKind } from './reason-question'

/**
 * The reason kinds that are about stored data. For these the thought is read again with the owner's
 * correction and its text is never edited (a reason is a complaint, not an edit instruction).
 * `wording_changed` is the one kind that edits the text; `not_worth_keeping` and `other` store the
 * vote only. The kind is Jev's label of the owner's reason; this list only says which labels
 * trigger the re-check.
 */
export const RECHECK_REASON_KINDS: readonly CaptureReasonKind[] = [
  'wrong_date',
  'wrong_name',
  'wrong_link',
  'split_wrong',
  'something_missing',
  'wrong_category',
]

export function isRecheckReasonKind(kind: CaptureReasonKind): boolean {
  return RECHECK_REASON_KINDS.includes(kind)
}
