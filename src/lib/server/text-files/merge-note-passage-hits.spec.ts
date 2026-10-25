import { describe, expect, it } from 'vitest'
import {
  buildPassageWindow,
  joinWindowPassages,
  NOTE_PASSAGE_NEIGHBOR_RADIUS,
  NOTE_PASSAGES_PER_NOTE_CAP,
  rankNotePassageHits,
  windowOrdinals,
  type PassageCandidate,
} from './merge-note-passage-hits'

function candidate(
  textFileId: string,
  ordinal: number,
  patch: Partial<PassageCandidate> = {},
): PassageCandidate {
  return { passageId: `${textFileId}-${ordinal}`, textFileId, ordinal, ...patch }
}

const base = { minScore: 0.2, perNoteCap: NOTE_PASSAGES_PER_NOTE_CAP, noteLimit: 5 }

describe('rankNotePassageHits', () => {
  it('scores a passage by its best signal: vector similarity or normalized lexical rank', () => {
    const ranked = rankNotePassageHits({
      ...base,
      passages: [
        candidate('a', 0, { vectorDistance: 0.6 }),
        candidate('b', 0, { lexicalRank: 0.4 }),
        candidate('c', 0, { vectorDistance: 0.5, lexicalRank: 0.1 }),
      ],
      noteLexical: [],
    })
    const byId = new Map(ranked.map((n) => [n.textFileId, n]))
    expect(byId.get('a')!.score).toBeCloseTo(0.4)
    expect(byId.get('b')!.score).toBe(1)
    expect(byId.get('c')!.score).toBeCloseTo(0.5)
    expect(ranked.map((n) => n.textFileId)).toEqual(['b', 'c', 'a'])
  })

  it('merges the vector and lexical rows of one passage into a single candidate', () => {
    const ranked = rankNotePassageHits({
      ...base,
      passages: [
        candidate('a', 4, { vectorDistance: 0.3 }),
        candidate('a', 4, { lexicalRank: 0.12 }),
      ],
      noteLexical: [],
    })
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.hitOrdinals).toEqual([4])
    expect(ranked[0]!.vectorScore).toBeCloseTo(0.7)
    expect(ranked[0]!.lexicalRank).toBeCloseTo(0.12)
  })

  it('drops passages below the relevance floor (nothing relevant means no note evidence)', () => {
    const ranked = rankNotePassageHits({
      ...base,
      passages: [candidate('a', 0, { vectorDistance: 0.9 }), candidate('b', 2, { vectorDistance: 0.95 })],
      noteLexical: [],
    })
    expect(ranked).toEqual([])
  })

  it('caps passages per note at the best N and returns their ordinals in reading order', () => {
    const passages = [9, 3, 7, 1, 5, 2].map((ordinal, i) =>
      candidate('a', ordinal, { vectorDistance: 0.1 + i * 0.05 }),
    )
    const ranked = rankNotePassageHits({ ...base, passages, noteLexical: [] })
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.hitOrdinals).toHaveLength(NOTE_PASSAGES_PER_NOTE_CAP)
    // the three smallest distances were ordinals 9, 3, 7
    expect(ranked[0]!.hitOrdinals).toEqual([3, 7, 9])
  })

  it('limits the number of notes and ranks notes by their best passage', () => {
    const passages = ['a', 'b', 'c', 'd'].map((id, i) =>
      candidate(id, 0, { vectorDistance: 0.2 + i * 0.1 }),
    )
    const ranked = rankNotePassageHits({ ...base, noteLimit: 2, passages, noteLexical: [] })
    expect(ranked.map((n) => n.textFileId)).toEqual(['a', 'b'])
  })

  it('a note-level keyword hit with no passage hit contributes its opening passage', () => {
    const ranked = rankNotePassageHits({
      ...base,
      passages: [],
      noteLexical: [{ textFileId: 'title-match', lexicalRank: 0.2 }],
    })
    expect(ranked).toEqual([
      expect.objectContaining({ textFileId: 'title-match', hitOrdinals: [0], score: 0.5 }),
    ])
  })

  it('a note-level keyword hit does not add ordinal 0 when passages already matched', () => {
    const ranked = rankNotePassageHits({
      ...base,
      passages: [candidate('a', 6, { vectorDistance: 0.4 })],
      noteLexical: [{ textFileId: 'a', lexicalRank: 0.3 }],
    })
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.hitOrdinals).toEqual([6])
    expect(ranked[0]!.score).toBeCloseTo(0.75)
  })

  it('applies the floor to note-level keyword hits too', () => {
    const ranked = rankNotePassageHits({
      ...base,
      minScore: 0.5,
      passages: [],
      noteLexical: [{ textFileId: 'weak', lexicalRank: 0.01 }],
    })
    expect(ranked).toEqual([])
  })
})

describe('windowOrdinals', () => {
  it('adds the +-1 neighbours of every hit once, in reading order, never below zero', () => {
    expect(NOTE_PASSAGE_NEIGHBOR_RADIUS).toBe(1)
    expect(windowOrdinals([0, 4, 5, 9], 1)).toEqual([0, 1, 3, 4, 5, 6, 8, 9, 10])
  })
})

describe('buildPassageWindow', () => {
  const available = new Map(
    [2, 3, 4, 7, 8].map((ordinal) => [
      ordinal,
      { ordinal, startChar: ordinal * 10, endChar: ordinal * 10 + 12, text: `p${ordinal}` },
    ]),
  )

  it('returns hit and neighbour passages in order, marking which ones matched', () => {
    const window = buildPassageWindow([3, 8], available, 1)
    expect(window.map((p) => [p.ordinal, p.isHit])).toEqual([
      [2, false],
      [3, true],
      [4, false],
      [7, false],
      [8, true],
    ])
  })
})

describe('joinWindowPassages', () => {
  it('joins consecutive passages without repeating their overlap and marks gaps', () => {
    const body = 'One is first. Two is second. Three is third. Four is fourth. Five is fifth.'
    const at = (s: string) => ({ startChar: body.indexOf(s), endChar: body.indexOf(s) + s.length })
    const p0 = 'One is first. Two is second.'
    const p1 = 'Two is second. Three is third.'
    const p3 = 'Five is fifth.'
    const joined = joinWindowPassages([
      { ordinal: 0, ...at(p0), text: p0, isHit: true },
      { ordinal: 1, ...at(p1), text: p1, isHit: false },
      { ordinal: 3, ...at(p3), text: p3, isHit: true },
    ])
    expect(joined).toBe('One is first. Two is second. Three is third.\n[…]\nFive is fifth.')
  })

  it('returns an empty string for an empty window', () => {
    expect(joinWindowPassages([])).toBe('')
  })
})
