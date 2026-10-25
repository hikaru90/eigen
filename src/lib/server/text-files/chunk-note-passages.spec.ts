import { describe, expect, it } from 'vitest'
import {
  chunkNoteIntoPassages,
  PASSAGE_MAX_CHARS,
  PASSAGE_MAX_SENTENCES,
  PASSAGE_MIN_CHARS,
  PASSAGE_MIN_SENTENCES,
  planPassageSync,
  type NotePassageChunk,
} from './chunk-note-passages'

const sentenceSegmenter = new Intl.Segmenter('und', { granularity: 'sentence' })

function countSentences(text: string): number {
  let n = 0
  for (const seg of sentenceSegmenter.segment(text)) {
    if (seg.segment.trim().length > 0) n++
  }
  return n
}

/** `count` English sentences of roughly `len` chars each, numbered so every one is unique. */
function sentences(count: number, len = 100, offset = 0): string {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const head = `Sentence number ${offset + i} talks about topic ${offset + i} in some detail`
    out.push(`${head}${' and more words'.repeat(Math.ceil(len / 15))}`.slice(0, len - 1) + '.')
  }
  return out.join(' ')
}

function expectExactSlices(body: string, chunks: NotePassageChunk[]): void {
  for (const c of chunks) {
    expect(c.text).toBe(body.slice(c.startChar, c.endChar))
    expect(c.text).toBe(c.text.trim())
  }
}

function expectCoversAllNonWhitespace(body: string, chunks: NotePassageChunk[]): void {
  const covered = new Array<boolean>(body.length).fill(false)
  for (const c of chunks) for (let i = c.startChar; i < c.endChar; i++) covered[i] = true
  for (let i = 0; i < body.length; i++) {
    if (/\S/.test(body[i]!)) expect(covered[i], `char ${i} (${body[i]}) uncovered`).toBe(true)
  }
}

describe('chunkNoteIntoPassages', () => {
  it('returns no passages for an empty or whitespace-only body', () => {
    expect(chunkNoteIntoPassages('')).toEqual([])
    expect(chunkNoteIntoPassages('  \n\n \t ')).toEqual([])
  })

  it('keeps a short note as exactly one passage with exact offsets', () => {
    const body = '  Taking an early morning out on the waves. Then the keynote.  '
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      ordinal: 0,
      text: 'Taking an early morning out on the waves. Then the keynote.',
    })
    expectExactSlices(body, chunks)
  })

  it('keeps a short list (many one-line sentences under the char cap) as one passage', () => {
    const body = Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n')
    expect(body.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
    expect(chunkNoteIntoPassages(body)).toHaveLength(1)
  })

  it('splits a long note into ordered passages: exact slices, full coverage, size cap', () => {
    const body = sentences(60, 110)
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThan(5)
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i))
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
    expectExactSlices(body, chunks)
    expectCoversAllNonWhitespace(body, chunks)
  })

  it('cuts non-final passages at 3-5 sentences and ~300-600 chars for medium sentences', () => {
    const body = sentences(40, 110)
    const chunks = chunkNoteIntoPassages(body)
    for (const c of chunks.slice(0, -1)) {
      const n = countSentences(c.text)
      expect(n).toBeGreaterThanOrEqual(PASSAGE_MIN_SENTENCES)
      expect(n).toBeLessThanOrEqual(PASSAGE_MAX_SENTENCES)
      expect(c.text.length).toBeGreaterThanOrEqual(PASSAGE_MIN_CHARS)
      expect(c.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
    }
  })

  it('overlaps consecutive passages by exactly one sentence', () => {
    const body = sentences(40, 110)
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThan(3)
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!
      const cur = chunks[i]!
      expect(cur.startChar).toBeGreaterThan(prev.startChar)
      expect(cur.endChar).toBeGreaterThan(prev.endChar)
      const overlap = body.slice(cur.startChar, prev.endChar)
      expect(overlap.length).toBeGreaterThan(0)
      expect(countSentences(overlap)).toBe(1)
    }
  })

  it('prefers paragraph boundaries once a passage has enough content', () => {
    const p1 = sentences(3, 110, 0)
    const p2 = sentences(3, 110, 10)
    const body = `${p1}\n\n${p2}`
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks[0]!.text).toBe(p1)
    expect(chunks[1]!.text.endsWith(p2.slice(-20))).toBe(true)
  })

  it('does not force a cut at a paragraph boundary when the passage is still tiny', () => {
    const body = `Short intro.\n\nAnother tiny paragraph.\n\nAnd a third one.`
    expect(chunkNoteIntoPassages(body)).toHaveLength(1)
  })

  it('cuts German text at sentence ends, not inside words', () => {
    const body = Array.from(
      { length: 24 },
      (_, i) => `Heute habe ich Nummer ${i} erledigt und danach noch einen langen Spaziergang gemacht.`,
    ).join(' ')
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.text.endsWith('.')).toBe(true)
    expectExactSlices(body, chunks)
    expectCoversAllNonWhitespace(body, chunks)
  })

  it('cuts Japanese (no spaces) at 。 and Chinese at 。！？', () => {
    const ja = Array.from({ length: 80 }, (_, i) => `今日は${i}番目の予定を終えて、長い散歩に出かけました。`).join('')
    const jaChunks = chunkNoteIntoPassages(ja)
    expect(jaChunks.length).toBeGreaterThan(2)
    for (const c of jaChunks) {
      expect(c.text.endsWith('。')).toBe(true)
      expect(c.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
    }
    expectExactSlices(ja, jaChunks)
    expectCoversAllNonWhitespace(ja, jaChunks)

    const zh = Array.from({ length: 80 }, (_, i) => `第${i}件事情已经办好了！我们接着去海边散步？好的。`).join('')
    const zhChunks = chunkNoteIntoPassages(zh)
    expect(zhChunks.length).toBeGreaterThan(2)
    for (const c of zhChunks) expect(/[。！？]$/.test(c.text)).toBe(true)
    expectCoversAllNonWhitespace(zh, zhChunks)
  })

  it('cuts Arabic text at sentence ends', () => {
    const body = Array.from({ length: 30 }, (_, i) => `ذهبت إلى البحر في الصباح الباكر رقم ${i} وقضيت وقتا طويلا هناك.`).join(' ')
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.text.endsWith('.')).toBe(true)
    expectCoversAllNonWhitespace(body, chunks)
  })

  it('splits one oversized sentence on word boundaries within the cap', () => {
    const body = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ')
    expect(countSentences(body)).toBe(1)
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
      expect(c.text).toMatch(/^word\d+/)
      expect(c.text).toMatch(/word\d+$/)
    }
    expectExactSlices(body, chunks)
    expectCoversAllNonWhitespace(body, chunks)
  })

  it('terminates on an unbroken token longer than the cap', () => {
    const body = 'a'.repeat(PASSAGE_MAX_CHARS * 3 + 17)
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThanOrEqual(4)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
    expectCoversAllNonWhitespace(body, chunks)
  })

  it('chunks newline-separated list lines and covers every line', () => {
    const body = Array.from({ length: 150 }, (_, i) => `- buy item number ${i}`).join('\n')
    const chunks = chunkNoteIntoPassages(body)
    expect(chunks.length).toBeGreaterThan(5)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(PASSAGE_MAX_CHARS)
    expectExactSlices(body, chunks)
    expectCoversAllNonWhitespace(body, chunks)
  })

  it('finds a specific detail deep in a long note in exactly the passage that holds it', () => {
    const filler = sentences(30, 110, 0)
    const needle = 'The invoice total for the Hamburg project is 48213 euros.'
    const body = `${filler} ${needle} ${sentences(30, 110, 100)}`
    const chunks = chunkNoteIntoPassages(body)
    const holders = chunks.filter((c) => c.text.includes('48213'))
    expect(holders.length).toBeGreaterThanOrEqual(1)
    expect(holders.length).toBeLessThanOrEqual(2)
    expect(holders[0]!.text).toContain(needle)
  })

  it('is deterministic', () => {
    const body = sentences(25, 120)
    expect(chunkNoteIntoPassages(body)).toEqual(chunkNoteIntoPassages(body))
  })
})

describe('planPassageSync', () => {
  const body = sentences(40, 110)
  const desired = chunkNoteIntoPassages(body)
  const stored = desired.map((c, i) => ({ id: `p${i}`, ...c }))

  it('creates every passage for a note without stored passages', () => {
    const plan = planPassageSync([], desired)
    expect(plan.deleteIds).toEqual([])
    expect(plan.insert).toEqual(desired)
  })

  it('does nothing when the stored passages already match', () => {
    const plan = planPassageSync(stored, desired)
    expect(plan.deleteIds).toEqual([])
    expect(plan.insert).toEqual([])
  })

  it('on append keeps the untouched head and re-embeds only the changed tail', () => {
    const appended = `${body} ${sentences(10, 110, 500)}`
    const next = chunkNoteIntoPassages(appended)
    const plan = planPassageSync(stored, next)
    const keptOrdinals = stored.length - plan.deleteIds.length
    expect(keptOrdinals).toBeGreaterThanOrEqual(stored.length - 1)
    expect(plan.insert.length).toBeGreaterThanOrEqual(2)
    expect(plan.insert.length).toBeLessThan(next.length)
    for (const c of plan.insert) expect(c.ordinal).toBeGreaterThanOrEqual(keptOrdinals)
    expect(plan.insert[plan.insert.length - 1]!.endChar).toBe(next[next.length - 1]!.endChar)
  })

  it('replaces passages from the edit point on when the middle changes', () => {
    const edited = body.replace('Sentence number 20 talks', 'Entirely different sentence about gardens talks')
    const next = chunkNoteIntoPassages(edited)
    const plan = planPassageSync(stored, next)
    expect(plan.deleteIds.length).toBeGreaterThan(0)
    expect(plan.insert.length).toBeGreaterThan(0)
    const unchangedHead = stored.filter((s) => !plan.deleteIds.includes(s.id))
    for (const s of unchangedHead) expect(next[s.ordinal]!.text).toBe(s.text)
  })

  it('deletes everything when the body becomes empty', () => {
    const plan = planPassageSync(stored, [])
    expect(plan.deleteIds).toHaveLength(stored.length)
    expect(plan.insert).toEqual([])
  })
})
