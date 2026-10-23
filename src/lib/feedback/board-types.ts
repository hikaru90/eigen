/**
 * The Make-me-better board's shapes (DESIGN.md "Make me better"). These types are
 * the contract the board UI renders against; the fixture (`fixture-board.ts`)
 * satisfies them today and the real board API will tomorrow. Nothing here is
 * fixture-specific — keep it that way so production paths never import the fixture.
 */

/** The mesh's label for a request: Idea, Bug or Polish. */
export type BoardKind = 'idea' | 'bug' | 'polish'
export const BOARD_KINDS: readonly BoardKind[] = ['idea', 'bug', 'polish']

/** Where in the app a request lives — the surfaces, plus "everywhere". */
export type BoardArea =
  'capture' | 'yarn' | 'threads' | 'patterns' | 'ask' | 'better' | 'everywhere'
export const BOARD_AREAS: readonly BoardArea[] = [
  'capture',
  'yarn',
  'threads',
  'patterns',
  'ask',
  'better',
  'everywhere',
]

/** The three tabs in plain words: Requested, In progress, Shipped. */
export type BoardStatus = 'requested' | 'in-progress' | 'shipped'
export const BOARD_STATUSES: readonly BoardStatus[] = ['requested', 'in-progress', 'shipped']

/** Someone around Eigenmesh. Avatars use soft, warm tints (DESIGN.md "Clay is people"). */
export type BoardPerson = { name: string; tint: string }

export type BoardIdea = {
  id: string
  /** In the asker's voice (Geist Mono). */
  title: string
  kind: BoardKind
  area: BoardArea
  /** A person id, or `'you'` for rows you shared. */
  by: string
  /** When it was asked, in whole days before now. */
  daysAgo: number
  /** How many people lent it their vote (including yours, when `mine`). */
  voices: number
  status: BoardStatus
  /** Requested rows the makers have picked up next show two dots instead of one. */
  planned?: boolean
  /** You lent this request one of your ten votes. */
  mine?: boolean
  /** You shared this one yourself. */
  own?: boolean
  /** "From the makers" — a short note in the mesh's voice. */
  note?: string
  /** Shipped rows only: when, in whole days before now. */
  shippedDaysAgo?: number
  /** Shipped since you last looked. */
  fresh?: boolean
}
