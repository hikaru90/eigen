import { describe, expect, it } from 'vitest'
import { answerRowSchema, askTurnRecordSchema } from './types'

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

describe('askTurnRecordSchema', () => {
  const turn = {
    personaId: 78,
    tenantUserId: 'public-bench-personamem-v2-ask-gpt-4o-mini-p78',
    turn: 3,
    clock: '2025-01-04T00:00:00.000Z',
    captures: 1,
    deletes: 0,
    toolNames: ['capture_thought', 'answer_question'],
    thoughtsCreated: 2,
    clockMismatches: 0,
    askUsd: 0.004,
    enrichUsd: 0.002,
    usd: 0.006,
    ms: 1200,
  }

  it('accepts a turn that stored nothing', () => {
    expect(
      askTurnRecordSchema.parse({ ...turn, captures: 0, thoughtsCreated: 0, toolNames: [] }),
    ).toMatchObject({ captures: 0 })
  })

  it('is strict and rejects negative counts', () => {
    expect(() => askTurnRecordSchema.parse({ ...turn, extra: 1 })).toThrow()
    expect(() => askTurnRecordSchema.parse({ ...turn, deletes: -1 })).toThrow()
  })
})
