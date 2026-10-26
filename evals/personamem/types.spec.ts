import { describe, expect, it } from 'vitest'
import { answerRowSchema, splitSchema } from './types'

const base = {
  questionId: 'p1-aaaaaaaaaaaa',
  personaId: 1,
  variant: 'eigen',
  prefType: 'neutral',
  updated: false,
  who: 'self',
  letter: 'A',
  correctLetter: 'A',
  correct: true,
  eigenAnswer: 'x',
  usd: 0.01,
  ms: 5,
}

describe('answerRowSchema', () => {
  it('requires createdAt on retrieved items and keeps only id, normalizedText, score, createdAt', () => {
    const ok = answerRowSchema.parse({
      ...base,
      retrieved: [
        { id: 't1', normalizedText: 'a', score: 0.5, createdAt: '2025-01-02T00:00:00.000Z' },
      ],
    })
    expect(ok.retrieved![0]).toEqual({
      id: 't1',
      normalizedText: 'a',
      score: 0.5,
      createdAt: '2025-01-02T00:00:00.000Z',
    })
    expect(() =>
      answerRowSchema.parse({
        ...base,
        retrieved: [{ id: 't1', normalizedText: 'a', score: 0.5 }],
      }),
    ).toThrow(/createdAt/)
  })

  it('knows what a retrieved item is: a thought, a note or a fact; rows written before facts have no kind', () => {
    for (const kind of ['thought', 'note', 'fact'] as const) {
      const ok = answerRowSchema.parse({
        ...base,
        retrieved: [
          {
            id: 'x1',
            kind,
            normalizedText: 'Fact about the user: swims',
            score: 0.5,
            createdAt: '2026-03-02T09:00:00.000Z',
          },
        ],
      })
      expect(ok.retrieved![0]!.kind).toBe(kind)
    }
    expect(() =>
      answerRowSchema.parse({
        ...base,
        retrieved: [
          {
            id: 'x1',
            kind: 'summary',
            normalizedText: 'a',
            score: 0.5,
            createdAt: '2026-03-02T09:00:00.000Z',
          },
        ],
      }),
    ).toThrow()
  })

  it('carries the cited ids next to the context items, as strings only', () => {
    const ok = answerRowSchema.parse({ ...base, retrieved: [], citedIds: ['t1', 't2'] })
    expect(ok.citedIds).toEqual(['t1', 't2'])
    expect(() => answerRowSchema.parse({ ...base, citedIds: [1] })).toThrow()
  })

  it('rejects an embedding smuggled into a retrieved item', () => {
    expect(() =>
      answerRowSchema.parse({
        ...base,
        retrieved: [
          {
            id: 't1',
            normalizedText: 'a',
            score: 0.5,
            createdAt: '2025-01-02T00:00:00.000Z',
            embedding: [0.1],
          },
        ],
      }),
    ).toThrow()
  })

  it('carries the best below-floor scores of an eigen row, null where nothing was dropped', () => {
    const ok = answerRowSchema.parse({
      ...base,
      belowFloor: { thoughts: 0.19, notePassages: null },
    })
    expect(ok.belowFloor).toEqual({ thoughts: 0.19, notePassages: null })
    expect(() => answerRowSchema.parse({ ...base, belowFloor: { thoughts: 0.19 } })).toThrow()
    expect(() =>
      answerRowSchema.parse({ ...base, belowFloor: { thoughts: 2, notePassages: null } }),
    ).toThrow()
  })
})

describe('splitSchema', () => {
  it('knows benchmark and val only', () => {
    expect(splitSchema.parse('val')).toBe('val')
    expect(splitSchema.parse('benchmark')).toBe('benchmark')
    expect(() => splitSchema.parse('test')).toThrow()
  })
})
