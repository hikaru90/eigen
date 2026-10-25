/**
 * Note passages (long-text memory L8): mechanical indexing of a note body into retrievable
 * windows. This is size/sentence arithmetic, not a semantic decision: boundaries come from
 * `Intl.Segmenter` (any script), never from word lists or patterns that judge meaning.
 *
 * - 3-5 sentences per passage, ~300-600 chars, cut at paragraph / sentence boundaries
 * - one sentence of overlap between neighbouring passages
 * - a body of at most PASSAGE_MAX_CHARS is a single passage
 * - one sentence (or one unbroken token) longer than the cap is split on word / code-point
 *   boundaries so no passage exceeds PASSAGE_MAX_CHARS
 *
 * Offsets are UTF-16 indices into the exact body string, so `text === body.slice(start, end)`.
 */

export const PASSAGE_MIN_SENTENCES = 3
export const PASSAGE_MAX_SENTENCES = 5
export const PASSAGE_MIN_CHARS = 300
export const PASSAGE_MAX_CHARS = 600
export const PASSAGE_OVERLAP_SENTENCES = 1

export type NotePassageChunk = {
  ordinal: number
  startChar: number
  endChar: number
  text: string
}

type Span = { start: number; end: number; paragraphStart: boolean }

// 'und' (root locale) applies the Unicode sentence-boundary rules without picking a language,
// so one segmenter serves every script (Latin, CJK, Arabic, ...).
const SENTENCE_SEGMENTER = new Intl.Segmenter('und', { granularity: 'sentence' })
const WORD_SEGMENTER = new Intl.Segmenter('und', { granularity: 'word' })

function trimmedSpan(body: string, start: number, end: number): { start: number; end: number } | null {
  let s = start
  let e = end
  while (s < e && /\s/.test(body[s]!)) s++
  while (e > s && /\s/.test(body[e - 1]!)) e--
  return e > s ? { start: s, end: e } : null
}

/** Greedy split of an over-long span on word boundaries; an over-long single word on code points. */
function splitOversizedSpan(
  body: string,
  span: { start: number; end: number },
): Array<{ start: number; end: number }> {
  const pieces: Array<{ start: number; end: number }> = []
  const push = (start: number, end: number) => {
    const trimmed = trimmedSpan(body, start, end)
    if (trimmed) pieces.push(trimmed)
  }
  let pieceStart = span.start
  let pieceEnd = span.start
  for (const seg of WORD_SEGMENTER.segment(body.slice(span.start, span.end))) {
    const segStart = span.start + seg.index
    const segEnd = segStart + seg.segment.length
    if (pieceEnd > pieceStart && segEnd - pieceStart > PASSAGE_MAX_CHARS) {
      push(pieceStart, pieceEnd)
      pieceStart = segStart
    }
    pieceEnd = segEnd
    // A single token longer than the cap: cut on a code-point boundary at or below the cap.
    while (pieceEnd - pieceStart > PASSAGE_MAX_CHARS) {
      let cut = pieceStart + PASSAGE_MAX_CHARS
      const code = body.charCodeAt(cut - 1)
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1
      push(pieceStart, cut)
      pieceStart = cut
    }
  }
  push(pieceStart, pieceEnd)
  return pieces
}

function splitIntoSpans(body: string): Span[] {
  const spans: Span[] = []
  let previousEnd = 0
  for (const seg of SENTENCE_SEGMENTER.segment(body)) {
    const trimmed = trimmedSpan(body, seg.index, seg.index + seg.segment.length)
    if (!trimmed) continue
    const gap = body.slice(previousEnd, trimmed.start)
    const paragraphStart = spans.length === 0 || (gap.match(/\n/g)?.length ?? 0) >= 2
    const pieces =
      trimmed.end - trimmed.start > PASSAGE_MAX_CHARS ? splitOversizedSpan(body, trimmed) : [trimmed]
    pieces.forEach((piece, i) =>
      spans.push({ ...piece, paragraphStart: i === 0 ? paragraphStart : false }),
    )
    previousEnd = trimmed.end
  }
  return spans
}

export function chunkNoteIntoPassages(body: string): NotePassageChunk[] {
  const whole = trimmedSpan(body, 0, body.length)
  if (!whole) return []
  if (whole.end - whole.start <= PASSAGE_MAX_CHARS) {
    return [{ ordinal: 0, startChar: whole.start, endChar: whole.end, text: body.slice(whole.start, whole.end) }]
  }

  const spans = splitIntoSpans(body)
  const chunks: NotePassageChunk[] = []
  let next = 0
  let previousCount = 0
  while (next < spans.length) {
    let first = next
    // Overlap: carry the previous passage's last sentence in, unless that would leave no room
    // for the new sentence (progress is guaranteed because `next` always advances).
    if (chunks.length > 0 && previousCount > PASSAGE_OVERLAP_SENTENCES) {
      const withOverlap = next - PASSAGE_OVERLAP_SENTENCES
      if (spans[next]!.end - spans[withOverlap]!.start <= PASSAGE_MAX_CHARS) first = withOverlap
    }

    let end = next + 1
    while (end < spans.length) {
      const candidate = spans[end]!
      const count = end - first
      const chars = spans[end - 1]!.end - spans[first]!.start
      if (candidate.end - spans[first]!.start > PASSAGE_MAX_CHARS) break
      if (count >= PASSAGE_MAX_SENTENCES) break
      const enough = count >= PASSAGE_MIN_SENTENCES || chars >= PASSAGE_MIN_CHARS
      if (candidate.paragraphStart && enough) break
      if (count >= PASSAGE_MIN_SENTENCES && chars >= PASSAGE_MIN_CHARS) break
      end++
    }

    const startChar = spans[first]!.start
    const endChar = spans[end - 1]!.end
    chunks.push({
      ordinal: chunks.length,
      startChar,
      endChar,
      text: body.slice(startChar, endChar),
    })
    previousCount = end - first
    next = end
  }
  return chunks
}

export type StoredPassageRef = NotePassageChunk & { id: string }

export type PassageSyncPlan = {
  /** Stored passages that no longer match the body. */
  deleteIds: string[]
  /** Passages to embed and insert (new or changed). */
  insert: NotePassageChunk[]
}

/**
 * Diff the stored passages against the passages the body now produces. A passage is kept when
 * ordinal, range and text are all unchanged, so an append re-embeds only the changed tail and a
 * title-only edit re-embeds nothing. The result is identical to a full rebuild.
 */
export function planPassageSync(
  stored: StoredPassageRef[],
  desired: NotePassageChunk[],
): PassageSyncPlan {
  const key = (c: NotePassageChunk) => `${c.ordinal}:${c.startChar}:${c.endChar}:${c.text}`
  const desiredKeys = new Set(desired.map(key))
  const storedKeys = new Set(stored.map(key))
  return {
    deleteIds: stored.filter((s) => !desiredKeys.has(key(s))).map((s) => s.id),
    insert: desired.filter((d) => !storedKeys.has(key(d))),
  }
}
