/**
 * How Eigen stored a capture, in plain words, for the Jev label of a 👎 reason
 * (docs/planning/capture-feedback.md §6). Built deterministically from what is stored NOW (before
 * the reason is applied as an edit), with no model:
 *
 *   Saved as {category} · about {names} · {event}: {when}; … · split into {n} thoughts
 *
 * The category is the key the kept strip shows, prettified; the names and dates are the same
 * persisted structure the capture audit reads (`CaptureAuditInput`), the dates in the audit's own
 * words. Nothing here matches or interprets text: it only formats what is stored. The capture's
 * own words are not part of it (the label request quotes them separately).
 */

import { categoryLabel } from '$lib/capture/reading-state'
import { describeStoredDates, type CaptureAuditInput } from './audit-questions'

export function buildStoredSummary(input: { category: string; audit: CaptureAuditInput }): string {
  if (input.category.trim() === '') {
    throw new Error('[capture-review] stored summary: category must not be empty')
  }
  const { audit } = input

  const segments = [`Saved as ${categoryLabel(input.category)}`]
  if (audit.names.length > 0) {
    segments.push(`about ${audit.names.map((name) => name.surface).join(', ')}`)
  }
  const dates = describeStoredDates(audit)
  if (dates.length > 0) segments.push(dates.join('; '))
  if (audit.pieces.length > 0) segments.push(`split into ${audit.pieces.length} thoughts`)
  return segments.join(' · ')
}
