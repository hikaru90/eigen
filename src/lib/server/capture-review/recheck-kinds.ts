import type { CaptureReasonKind } from './reason-question'

/**
 * The reason kinds that are about stored data, so the stored data is read again for them when the
 * edit alone changed nothing (docs/planning/capture-feedback.md, C5 follow-up). The other kinds
 * (`wording_changed`, `not_worth_keeping`, `other`) stay edit-only. The kind is Jev's label of the
 * owner's reason; this list only says which labels trigger the re-check.
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
