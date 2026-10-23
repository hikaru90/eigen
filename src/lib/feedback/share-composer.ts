import {
  BOARD_AREAS,
  BOARD_KINDS,
  type BoardArea,
  type BoardIdea,
  type BoardKind,
} from './board-types'

/**
 * The share composer's pure parts (DESIGN.md "The same gesture as capture").
 *
 * The reading line — *Sounds like **a bug** in **Capture*** — is a MANUAL chooser
 * this pass: both underlined words cycle on tap and nothing is guessed from the
 * typed words. The repo forbids string heuristics for meaning; the mesh's own
 * reading arrives with the board backend as an LLM contract (ei app.js:1537
 * `classify()` was deliberately not ported).
 *
 * The chorus card ("Someone had a similar thought") fires only on an *exact*
 * duplicate title among open requests: that is dedup by equality, not a
 * similarity judgement. Near-copies are the backend's call.
 */

export type ReadingChoice = { kind: BoardKind; area: BoardArea }

export const DEFAULT_READING: ReadingChoice = { kind: 'idea', area: 'everywhere' }

function cycle<T>(list: readonly T[], current: T): T {
  const at = list.indexOf(current)
  return list[(at + 1) % list.length]
}

export function nextKind(kind: BoardKind): BoardKind {
  return cycle(BOARD_KINDS, kind)
}

export function nextArea(area: BoardArea): BoardArea {
  return cycle(BOARD_AREAS, area)
}

/** There is something to send, and it fits the shared feedback limit. */
export function canShare(text: string, maxLength: number): boolean {
  const trimmed = text.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength
}

/** Equality normalization only: trim, collapse whitespace, case-fold. Not meaning. */
export function normalizeTitle(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * An open request (not shipped, not yours) whose title equals the draft once both
 * are normalized. Null for anything less than an exact match.
 */
export function findExactDuplicate(ideas: readonly BoardIdea[], draft: string): BoardIdea | null {
  const wanted = normalizeTitle(draft)
  if (!wanted) return null
  return (
    ideas.find((i) => i.status !== 'shipped' && !i.own && normalizeTitle(i.title) === wanted) ??
    null
  )
}
