import type { BoardArea, BoardKind } from '$lib/feedback/board-types'

/**
 * The board's ontology: the closed catalog the LLM judge picks kind and area from.
 * Keys are the DB check-constraint values; definitions are what the judge reads.
 */
export const BOARD_KIND_CATALOG: Readonly<Record<BoardKind, string>> = {
  idea: 'A new capability or behaviour the person wants Eigenmesh to have.',
  bug: 'Something that exists but is broken, wrong, lost or crashes — it does not work as intended.',
  polish:
    'Something that works but feels rough: layout, wording, readability, small friction, look and feel.',
}

export const BOARD_AREA_CATALOG: Readonly<Record<BoardArea, string>> = {
  capture:
    'Capture — writing or speaking a thought into the mesh (text box, voice recording, the reading/keep step).',
  yarn: 'Yarn — the journal of stored thoughts over time, reading and searching past thoughts.',
  threads: 'Threads — projects, tasks and ongoing bodies of work the mesh tracks.',
  patterns: 'Patterns — the map/graph of entities, clusters and connections between thoughts.',
  ask: 'Ask — asking questions and chatting with the mesh about your memories.',
  better: 'Make me better / Contribute — this ideas board, voting and feedback itself.',
  everywhere:
    'Everywhere — the whole app or several surfaces at once (theme, navigation, accounts, speed, billing).',
}
