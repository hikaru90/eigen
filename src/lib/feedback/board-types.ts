/**
 * The Contribute board's shapes (docs/planning/feature-multiplayer-board.md §6).
 * These are the wire contract of `GET /api/board` and the share/vote endpoints;
 * the server builds them (`src/lib/server/board/service.ts`) and the page renders
 * them. Author identity is a display string only ("Noor K.") — never an email or id.
 */

/** Up (1) or down (-1): the two vote controls. */
export type VoteDirection = 1 | -1
/** Your stored vote: up, down, or none (0). */
export type MyVote = -1 | 0 | 1

/** The mesh's label for a request: Idea, Bug or Polish. */
export type BoardKind = 'idea' | 'bug' | 'polish'
export const BOARD_KINDS = ['idea', 'bug', 'polish'] as const satisfies readonly BoardKind[]

/** Where in the app a request lives — the surfaces, plus "everywhere". */
export type BoardArea =
  'capture' | 'yarn' | 'threads' | 'patterns' | 'ask' | 'better' | 'everywhere'
export const BOARD_AREAS = [
  'capture',
  'yarn',
  'threads',
  'patterns',
  'ask',
  'better',
  'everywhere',
] as const satisfies readonly BoardArea[]

/** The three tabs in plain words: Requested, In progress, Shipped. */
export type BoardStatus = 'requested' | 'in-progress' | 'shipped'
export const BOARD_STATUSES = [
  'requested',
  'in-progress',
  'shipped',
] as const satisfies readonly BoardStatus[]

/** Every stored status. `rejected` is makers-only: RLS keeps it off the board for everyone. */
export type BoardIdeaStatus = BoardStatus | 'rejected'
export const BOARD_IDEA_STATUSES = [
  ...BOARD_STATUSES,
  'rejected',
] as const satisfies readonly BoardIdeaStatus[]

/** Who asked, as everyone else sees it. */
export type BoardAuthor = { display: string; isYou: boolean }

export type BoardIdea = {
  id: string
  /** Verbatim, in the asker's voice. */
  title: string
  kind: BoardKind
  area: BoardArea
  status: BoardStatus
  /** Requested rows the makers have picked up next show two dots instead of one. */
  planned: boolean
  /** "From the makers" — a short note. */
  note: string | null
  /** Net score: upvotes minus downvotes (computed server-side from all votes). */
  score: number
  myVote: MyVote
  /** Null when the author deleted their account or carries no name. */
  author: BoardAuthor | null
  /** ISO timestamps. */
  createdAt: string
  shippedAt: string | null
  /** You shared this one yourself. */
  own: boolean
}

/** `POST /api/board/ideas/check` — the LLM judge's reading of a draft. */
export type BoardCheckResult = {
  kind: BoardKind
  area: BoardArea
  duplicateOf: BoardIdea | null
}

/** `POST /api/board/ideas` — the idea is kept even when the inbox email fails (D4). */
export type BoardShareResult = {
  idea: BoardIdea
  inbox: 'sent' | 'failed'
  inboxError?: string
}

export type BoardVoteResult = { score: number; myVote: MyVote }
