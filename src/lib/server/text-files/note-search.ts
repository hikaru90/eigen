import {
  buildPassageWindow,
  joinWindowPassages,
  NOTE_PASSAGE_NEIGHBOR_RADIUS,
  NOTE_PASSAGES_PER_NOTE_CAP,
  rankNotePassageHits,
  windowOrdinals,
  type NoteLexicalCandidate,
  type PassageCandidate,
  type PassageText,
} from './merge-note-passage-hits'

export const TEXT_FILE_PREVIEW_LEN = 200

/**
 * One note that matched a query. `excerpt` is the matched passage(s) with their +-1 neighbours
 * (overlap written once), so a hit carries the detail itself, not the head of the note.
 * The id is the note's: citations point to the note, never to a passage.
 */
export type TextFileSearchHit = {
  id: string
  title: string
  preview: string
  excerpt: string
  /** Ordinals of the passages that matched (capped per note), in reading order. */
  matchedOrdinals: number[]
  /** Best signal for this note, 0..1. */
  score: number
  /** Best cosine similarity among matched passages (0 when the note matched by keyword only). */
  vectorScore: number
  createdAt: string
  updatedAt: string
  author: 'user' | 'agent'
  authorLabel: string | null
  authorKeyId: string | null
}

export type NoteMeta = {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  author: 'user' | 'agent'
  authorLabel: string | null
  authorKeyId: string | null
}

export type NotePassageText = PassageText & { textFileId: string }

/** The data sources of a note search; real ones read Postgres, tests inject their own. */
export type NoteSearchSources = {
  /** Vector (ANN) and passage-FTS candidates for the query. */
  passageCandidates: () => Promise<PassageCandidate[]>
  /** Whole-note keyword matches (title + body), the signal title searches rely on. */
  noteLexical: () => Promise<NoteLexicalCandidate[]>
  /** Visible notes among `ids` (author filter and tenant already applied). */
  loadNotes: (ids: string[]) => Promise<NoteMeta[]>
  /** Decrypted passage texts for the requested (note, ordinal) pairs that exist. */
  loadPassages: (pairs: Array<{ textFileId: string; ordinal: number }>) => Promise<NotePassageText[]>
}

export async function runNoteSearch(
  sources: NoteSearchSources,
  params: { minScore: number; noteLimit: number },
): Promise<TextFileSearchHit[]> {
  const [passages, noteLexical] = await Promise.all([
    sources.passageCandidates(),
    sources.noteLexical(),
  ])
  const ranked = rankNotePassageHits({
    passages,
    noteLexical,
    minScore: params.minScore,
    perNoteCap: NOTE_PASSAGES_PER_NOTE_CAP,
    noteLimit: params.noteLimit,
  })
  if (ranked.length === 0) return []

  const notes = new Map(
    (await sources.loadNotes(ranked.map((r) => r.textFileId))).map((n) => [n.id, n]),
  )
  const visible = ranked.filter((r) => notes.has(r.textFileId))

  const wanted = visible.flatMap((r) =>
    windowOrdinals(r.hitOrdinals, NOTE_PASSAGE_NEIGHBOR_RADIUS).map((ordinal) => ({
      textFileId: r.textFileId,
      ordinal,
    })),
  )
  const loaded = wanted.length > 0 ? await sources.loadPassages(wanted) : []
  const passagesByNote = new Map<string, Map<number, PassageText>>()
  for (const p of loaded) {
    const byOrdinal = passagesByNote.get(p.textFileId) ?? new Map<number, PassageText>()
    byOrdinal.set(p.ordinal, p)
    passagesByNote.set(p.textFileId, byOrdinal)
  }

  return visible.map((r) => {
    const note = notes.get(r.textFileId)!
    const window = buildPassageWindow(
      r.hitOrdinals,
      passagesByNote.get(r.textFileId) ?? new Map(),
      NOTE_PASSAGE_NEIGHBOR_RADIUS,
    )
    const firstMatched = window.find((p) => p.isHit)
    return {
      id: note.id,
      title: note.title,
      preview: (firstMatched?.text ?? '').slice(0, TEXT_FILE_PREVIEW_LEN),
      excerpt: joinWindowPassages(window),
      matchedOrdinals: r.hitOrdinals,
      score: r.score,
      vectorScore: r.vectorScore,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      author: note.author,
      authorLabel: note.authorLabel,
      authorKeyId: note.authorKeyId,
    }
  })
}
