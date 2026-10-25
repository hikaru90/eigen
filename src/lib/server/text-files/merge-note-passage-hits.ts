import { normalizeLexicalRank } from '$lib/server/retrieval/rrf-scoring'

/**
 * Merge of note-passage search signals (pgvector ANN + passage FTS + note-level keyword match)
 * into per-note hits. Pure ranking arithmetic over scores — no text is interpreted here.
 */

/** At most this many matched passages are kept per note (neighbours come on top). */
export const NOTE_PASSAGES_PER_NOTE_CAP = 3
/** A hit also returns this many passages on each side of every matched passage. */
export const NOTE_PASSAGE_NEIGHBOR_RADIUS = 1

export type PassageCandidate = {
  passageId: string
  textFileId: string
  ordinal: number
  /** pgvector cosine distance (ANN side). */
  vectorDistance?: number
  /** Postgres ts_rank_cd (FTS side). */
  lexicalRank?: number
}

export type NoteLexicalCandidate = { textFileId: string; lexicalRank: number }

export type RankedNoteHit = {
  textFileId: string
  /** Best signal across the note's matched passages and its note-level keyword match, 0..1. */
  score: number
  /** Best cosine similarity among the matched passages (0 when none matched by vector). */
  vectorScore: number
  /** Best raw ts_rank_cd among the matched passages and the note-level match. */
  lexicalRank: number
  /** Matched passage ordinals in reading order (at most `perNoteCap`). */
  hitOrdinals: number[]
}

function cosineSimilarity(distance: number): number {
  return Math.max(0, 1 - distance)
}

export function rankNotePassageHits(input: {
  passages: PassageCandidate[]
  noteLexical: NoteLexicalCandidate[]
  /** Relevance floor on the 0..1 score; below it a signal is not evidence. */
  minScore: number
  perNoteCap: number
  noteLimit: number
}): RankedNoteHit[] {
  const byPassage = new Map<string, PassageCandidate>()
  for (const c of input.passages) {
    const existing = byPassage.get(c.passageId)
    if (!existing) {
      byPassage.set(c.passageId, { ...c })
      continue
    }
    if (c.vectorDistance !== undefined) {
      existing.vectorDistance = Math.min(existing.vectorDistance ?? Infinity, c.vectorDistance)
    }
    if (c.lexicalRank !== undefined) {
      existing.lexicalRank = Math.max(existing.lexicalRank ?? 0, c.lexicalRank)
    }
  }

  type Scored = { ordinal: number; score: number; vectorScore: number; lexicalRank: number }
  const byNote = new Map<string, Scored[]>()
  for (const c of byPassage.values()) {
    const vectorScore = c.vectorDistance !== undefined ? cosineSimilarity(c.vectorDistance) : 0
    const lexicalRank = c.lexicalRank ?? 0
    const score = Math.max(vectorScore, normalizeLexicalRank(lexicalRank))
    if (score < input.minScore) continue
    const list = byNote.get(c.textFileId) ?? []
    list.push({ ordinal: c.ordinal, score, vectorScore, lexicalRank })
    byNote.set(c.textFileId, list)
  }

  const noteLexicalRank = new Map<string, number>()
  for (const n of input.noteLexical) {
    noteLexicalRank.set(n.textFileId, Math.max(noteLexicalRank.get(n.textFileId) ?? 0, n.lexicalRank))
  }

  const noteIds = new Set<string>([...byNote.keys()])
  for (const [id, rank] of noteLexicalRank) {
    if (normalizeLexicalRank(rank) >= input.minScore) noteIds.add(id)
  }

  const ranked: RankedNoteHit[] = []
  for (const textFileId of noteIds) {
    const matched = (byNote.get(textFileId) ?? [])
      .sort((a, b) => b.score - a.score || a.ordinal - b.ordinal)
      .slice(0, input.perNoteCap)
    const noteRank = noteLexicalRank.get(textFileId) ?? 0
    const noteScore = normalizeLexicalRank(noteRank)
    const passageScore = matched.reduce((best, m) => Math.max(best, m.score), 0)
    ranked.push({
      textFileId,
      score: Math.max(passageScore, noteScore),
      vectorScore: matched.reduce((best, m) => Math.max(best, m.vectorScore), 0),
      lexicalRank: matched.reduce((best, m) => Math.max(best, m.lexicalRank), noteRank),
      // A note-level keyword hit (title / whole-note match) with no matching passage shows the
      // note's opening passage.
      hitOrdinals: matched.length > 0 ? matched.map((m) => m.ordinal).sort((a, b) => a - b) : [0],
    })
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.textFileId.localeCompare(b.textFileId))
    .slice(0, input.noteLimit)
}

/** Matched ordinals plus their neighbours, unique, ascending, never negative. */
export function windowOrdinals(hitOrdinals: number[], radius: number): number[] {
  const out = new Set<number>()
  for (const ordinal of hitOrdinals) {
    for (let o = Math.max(0, ordinal - radius); o <= ordinal + radius; o++) out.add(o)
  }
  return [...out].sort((a, b) => a - b)
}

export type PassageText = { ordinal: number; startChar: number; endChar: number; text: string }
export type WindowPassage = PassageText & { isHit: boolean }

/** The passages of a hit's window that exist, in reading order, flagged by whether they matched. */
export function buildPassageWindow(
  hitOrdinals: number[],
  available: Map<number, PassageText>,
  radius: number,
): WindowPassage[] {
  const hits = new Set(hitOrdinals)
  const out: WindowPassage[] = []
  for (const ordinal of windowOrdinals(hitOrdinals, radius)) {
    const passage = available.get(ordinal)
    if (passage) out.push({ ...passage, isHit: hits.has(ordinal) })
  }
  return out
}

export const PASSAGE_GAP_MARKER = '[…]'

/**
 * Join window passages into one excerpt: neighbouring passages overlap by a sentence, so the
 * shared range is written once; passages that are not adjacent are separated by a gap marker.
 */
export function joinWindowPassages(passages: WindowPassage[]): string {
  let out = ''
  let previous: WindowPassage | null = null
  for (const passage of passages) {
    if (!previous) {
      out = passage.text
    } else if (passage.ordinal !== previous.ordinal + 1) {
      out += `\n${PASSAGE_GAP_MARKER}\n${passage.text}`
    } else if (passage.startChar < previous.endChar) {
      out += passage.text.slice(previous.endChar - passage.startChar)
    } else {
      out += `\n${passage.text}`
    }
    previous = passage
  }
  return out
}
