import { BOARD_AREAS, BOARD_KINDS, type BoardArea, type BoardKind } from './board-types'

/**
 * The share composer's pure parts. Kind and area come from the board's LLM judge
 * (`POST /api/board/ideas/check`, D5); `nextKind` / `nextArea` are how the author
 * corrects them on their own Requested row. Duplicates are the judge's call —
 * nothing on the client compares titles.
 */

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
