import type { QuestionEvidence } from './plan'
import { describe, expect, it } from 'vitest'
import { captureFamilies, evidenceHitFor, evidenceItemIds, splitFromOf } from './evidence-items'

describe('splitFromOf', () => {
  it('reads the parent id of a split child', () => {
    expect(splitFromOf({ splitFrom: 'parent-1' })).toBe('parent-1')
    expect(splitFromOf({ splitFrom: 'parent-1', other: 1 })).toBe('parent-1')
  })

  it('is null for a thought that is not a split child', () => {
    expect(splitFromOf({})).toBeNull()
    expect(splitFromOf({ splitInto: ['a'] })).toBeNull()
    expect(splitFromOf(null)).toBeNull()
    expect(splitFromOf({ encrypted: true })).toBeNull()
  })

  it('fails loud on a splitFrom that is not a string id', () => {
    expect(() => splitFromOf({ splitFrom: 7 })).toThrow(/splitFrom/)
    expect(() => splitFromOf({ splitFrom: '' })).toThrow(/splitFrom/)
  })
})

describe('captureFamilies', () => {
  const thoughts = [
    { id: 'c0', splitFrom: null },
    { id: 'c1', splitFrom: null },
    { id: 'c1-a', splitFrom: 'c1' },
    { id: 'c1-b', splitFrom: 'c1' },
    { id: 'c2', splitFrom: null },
  ]

  it('is the capture thought itself when nothing was split off it', () => {
    const families = captureFamilies(['c0', 'c1', 'c2'], thoughts, [])
    expect([...families.get('c0')!]).toEqual(['c0'])
  })

  it('adds the split children of a capture', () => {
    const families = captureFamilies(['c0', 'c1', 'c2'], thoughts, [])
    expect([...families.get('c1')!].sort()).toEqual(['c1', 'c1-a', 'c1-b'])
    expect([...families.get('c2')!]).toEqual(['c2'])
  })

  it('follows a chain of children', () => {
    const chain = [...thoughts, { id: 'c1-a-x', splitFrom: 'c1-a' }]
    expect([...captureFamilies(['c1'], chain, []).get('c1')!].sort()).toEqual([
      'c1',
      'c1-a',
      'c1-a-x',
      'c1-b',
    ])
  })

  it('adds the notes linked to the capture thought or to any of its children', () => {
    const families = captureFamilies(['c0', 'c1'], thoughts, [
      { thoughtId: 'c0', textFileId: 'note-0' },
      { thoughtId: 'c1-b', textFileId: 'note-1' },
      { thoughtId: 'c2', textFileId: 'note-2' },
    ])
    expect([...families.get('c0')!].sort()).toEqual(['c0', 'note-0'])
    expect([...families.get('c1')!].sort()).toEqual(['c1', 'c1-a', 'c1-b', 'note-1'])
  })

  it('fails loud for a capture thought that the tenant does not hold', () => {
    expect(() => captureFamilies(['gone'], thoughts, [])).toThrow(/gone/)
  })
})

describe('evidenceItemIds', () => {
  const thoughtIds = ['c0', 'c1', 'c2']
  const families = captureFamilies(
    thoughtIds,
    [
      { id: 'c0', splitFrom: null },
      { id: 'c1', splitFrom: null },
      { id: 'c1-a', splitFrom: 'c1' },
      { id: 'c2', splitFrom: null },
    ],
    [{ thoughtId: 'c2', textFileId: 'note-2' }],
  )

  it('is the union of the families of the evidence captures', () => {
    expect([...evidenceItemIds(thoughtIds, [1, 2], families)].sort()).toEqual([
      'c1',
      'c1-a',
      'c2',
      'note-2',
    ])
  })

  it('fails loud on a capture index the ingest has no thought for', () => {
    expect(() => evidenceItemIds(thoughtIds, [3], families)).toThrow(/capture 3/)
  })
})

describe('evidenceHitFor', () => {
  const thoughtIds = ['c0', 'c1']
  const families = captureFamilies(
    thoughtIds,
    [
      { id: 'c0', splitFrom: null },
      { id: 'c1', splitFrom: null },
      { id: 'c1-a', splitFrom: 'c1' },
    ],
    [{ thoughtId: 'c1', textFileId: 'note-1' }],
  )
  const aligned: QuestionEvidence = { kind: 'aligned', captureIndexes: [1] }

  it('is a hit when the chooser context holds the capture thought, a split child or a linked note', () => {
    for (const id of ['c1', 'c1-a', 'note-1']) {
      expect(evidenceHitFor(aligned, thoughtIds, families, [{ id: 'other' }, { id }])).toEqual({
        inHistory: true,
        items: 3,
        hit: true,
      })
    }
  })

  it('is a miss when the context holds only other items, or nothing', () => {
    expect(evidenceHitFor(aligned, thoughtIds, families, [{ id: 'c0' }])).toEqual({
      inHistory: true,
      items: 3,
      hit: false,
    })
    expect(evidenceHitFor(aligned, thoughtIds, families, [])).toMatchObject({ hit: false })
  })

  it('a question whose evidence is not in the history has nothing to hit', () => {
    expect(
      evidenceHitFor({ kind: 'not-in-history' }, thoughtIds, families, [{ id: 'c1' }]),
    ).toEqual({
      inHistory: false,
    })
  })

  it('an evidence-only question carries no history evidence field', () => {
    expect(
      evidenceHitFor({ kind: 'evidence-only' }, thoughtIds, families, [{ id: 'c1' }]),
    ).toBeUndefined()
  })
})
