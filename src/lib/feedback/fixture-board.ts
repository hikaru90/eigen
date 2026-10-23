// FIXTURE — replace with the real board API
//
// Sample board for the Make-me-better surface (docs/planning/ei-redesign.md,
// decision 4): the full page UI ships this pass over this client-side fixture; the
// multiplayer backend (shared requests, persisted votes, the agent that picks up
// voted items) is a later pass. Shaped like ~/+Code/ei/data.js `ideas`, with the
// titles rewritten for this product. Nothing outside the /feedback surface may
// import this file, and nothing in production paths derives from it.

import type { BoardIdea, BoardPerson } from './board-types'

/** People around Eigenmesh. Soft, warm tints — clay is people. */
export const FIXTURE_BOARD_PEOPLE: Readonly<Record<string, BoardPerson>> = {
  noor: { name: 'Noor', tint: '#c98b6b' },
  elio: { name: 'Elio', tint: '#8a9a7b' },
  tomas: { name: 'Tomas', tint: '#7d8fa6' },
  sana: { name: 'Sana', tint: '#b58aa0' },
  rhea: { name: 'Rhea', tint: '#c7a35a' },
  otto: { name: 'Otto', tint: '#8c8c78' },
}

/** `mine` = you lent it a vote; `planned` = the makers picked it up next (two dots). */
export const FIXTURE_BOARD_IDEAS: readonly BoardIdea[] = [
  // Requested
  {
    id: 'fx-r1',
    title: 'A home-screen shortcut that opens straight into Capture',
    kind: 'idea',
    area: 'capture',
    by: 'elio',
    daysAgo: 19,
    voices: 187,
    status: 'requested',
    planned: true,
    mine: true,
    note: 'Picked up for the next round of work.',
  },
  {
    id: 'fx-r2',
    title: 'Show which thread a thought landed on, right after capture',
    kind: 'idea',
    area: 'yarn',
    by: 'noor',
    daysAgo: 11,
    voices: 94,
    status: 'requested',
    mine: true,
  },
  {
    id: 'fx-r3',
    title: 'Let Ask answer from one thread only',
    kind: 'idea',
    area: 'ask',
    by: 'tomas',
    daysAgo: 6,
    voices: 71,
    status: 'requested',
    planned: true,
  },
  {
    id: 'fx-r4',
    title: 'Voice capture drops the last few words after a pause',
    kind: 'bug',
    area: 'capture',
    by: 'sana',
    daysAgo: 3,
    voices: 48,
    status: 'requested',
    note: 'We can reproduce it on iOS. Looking at how pauses end a recording.',
  },
  {
    id: 'fx-r5',
    title: 'Running stitches between days look uneven on wide screens',
    kind: 'polish',
    area: 'yarn',
    by: 'rhea',
    daysAgo: 8,
    voices: 27,
    status: 'requested',
  },
  {
    id: 'fx-r6',
    title: 'A gentler way to read long thoughts on a phone',
    kind: 'polish',
    area: 'everywhere',
    by: 'otto',
    daysAgo: 13,
    voices: 22,
    status: 'requested',
  },
  {
    id: 'fx-r7',
    title: 'Search misses words with accents',
    kind: 'bug',
    area: 'yarn',
    by: 'noor',
    daysAgo: 2,
    voices: 15,
    status: 'requested',
  },

  // In progress
  {
    id: 'fx-l1',
    title: 'Offline capture that syncs when you are back',
    kind: 'idea',
    area: 'capture',
    by: 'otto',
    daysAgo: 24,
    voices: 132,
    status: 'in-progress',
    mine: true,
    note: 'On the loom. The queue already holds thoughts; showing their sync is what is left.',
  },
  {
    id: 'fx-l2',
    title: 'The Patterns map is hard to read on a small screen',
    kind: 'polish',
    area: 'patterns',
    by: 'rhea',
    daysAgo: 10,
    voices: 36,
    status: 'in-progress',
  },

  // Shipped
  {
    id: 'fx-s1',
    title: 'Find a thought by its exact words, not only its meaning',
    kind: 'idea',
    area: 'ask',
    by: 'sana',
    daysAgo: 44,
    voices: 158,
    status: 'shipped',
    shippedDaysAgo: 3,
    mine: true,
    fresh: true,
  },
  {
    id: 'fx-s2',
    title: 'A page for one thought, with the thoughts that echo it',
    kind: 'idea',
    area: 'yarn',
    by: 'elio',
    daysAgo: 58,
    voices: 203,
    status: 'shipped',
    shippedDaysAgo: 14,
    mine: true,
  },
  {
    id: 'fx-s3',
    title: 'Forgetting a thought should feel quiet, not alarming',
    kind: 'polish',
    area: 'everywhere',
    by: 'tomas',
    daysAgo: 51,
    voices: 41,
    status: 'shipped',
    shippedDaysAgo: 29,
  },
]
