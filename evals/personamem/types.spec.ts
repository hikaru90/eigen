import { describe, expect, it } from 'vitest'
import { answerRowSchema } from './types'

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
})
