import type { AnswerRow } from './types'
import { describe, expect, it } from 'vitest'
import { distanceBucket, scoreAnswers } from './score'

function answer(
  questionId: string,
  variant: AnswerRow['variant'],
  correct: boolean,
  meta: { prefType: string; updated: boolean; who: string },
  usd: number,
): AnswerRow {
  return {
    questionId,
    personaId: 1,
    variant,
    ...meta,
    letter: correct ? 'A' : 'B',
    correctLetter: 'A',
    correct,
    usd,
    ms: 1000,
  }
}

const q1 = { prefType: 'pref_a', updated: false, who: 'self' }
const q2 = { prefType: 'pref_a', updated: true, who: 'self' }
const q3 = { prefType: 'pref_b', updated: false, who: 'others' }

const rows: AnswerRow[] = [
  answer('q1', 'eigen', true, q1, 0.01),
  answer('q1', 'no-memory', false, q1, 0.002),
  answer('q2', 'eigen', true, q2, 0.01),
  answer('q2', 'no-memory', true, q2, 0.002),
  answer('q3', 'eigen', false, q3, 0.01),
  answer('q3', 'no-memory', false, q3, 0.002),
]

const distance = new Map([
  ['q1', 4000],
  ['q2', 12000],
  ['q3', 30000],
])

describe('distanceBucket', () => {
  it('buckets by 8k boundaries', () => {
    expect(distanceBucket(0)).toBe('0-8k')
    expect(distanceBucket(7999)).toBe('0-8k')
    expect(distanceBucket(8000)).toBe('8-16k')
    expect(distanceBucket(16000)).toBe('16-24k')
    expect(distanceBucket(23999)).toBe('16-24k')
    expect(distanceBucket(24000)).toBe('24k+')
  })
})

describe('scoreAnswers', () => {
  const score = scoreAnswers(rows, distance)

  it('computes overall accuracy per variant and the lift', () => {
    expect(score.questions).toBe(3)
    expect(score.overall.eigenCorrect).toBe(2)
    expect(score.overall.noMemoryCorrect).toBe(1)
    expect(score.overall.eigenAccuracy).toBeCloseTo(2 / 3, 10)
    expect(score.overall.noMemoryAccuracy).toBeCloseTo(1 / 3, 10)
    expect(score.overall.lift).toBeCloseTo(1 / 3, 10)
  })

  it('breaks down by pref_type', () => {
    expect(score.byPrefType.pref_a).toMatchObject({
      n: 2,
      eigenAccuracy: 1,
      noMemoryAccuracy: 0.5,
      lift: 0.5,
    })
    expect(score.byPrefType.pref_b).toMatchObject({
      n: 1,
      eigenAccuracy: 0,
      noMemoryAccuracy: 0,
      lift: 0,
    })
  })

  it('breaks down by updated, who and distance bucket', () => {
    expect(score.byUpdated.true).toMatchObject({
      n: 1,
      eigenAccuracy: 1,
      noMemoryAccuracy: 1,
      lift: 0,
    })
    expect(score.byUpdated.false).toMatchObject({
      n: 2,
      eigenAccuracy: 0.5,
      noMemoryAccuracy: 0,
      lift: 0.5,
    })
    expect(score.byWho.self).toMatchObject({
      n: 2,
      eigenAccuracy: 1,
      noMemoryAccuracy: 0.5,
      lift: 0.5,
    })
    expect(score.byWho.others).toMatchObject({ n: 1, eigenAccuracy: 0 })
    expect(Object.keys(score.byDistance)).toEqual(['0-8k', '8-16k', '24k+'])
    expect(score.byDistance['0-8k']).toMatchObject({
      n: 1,
      eigenAccuracy: 1,
      noMemoryAccuracy: 0,
      lift: 1,
    })
    expect(score.byDistance['24k+']).toMatchObject({ n: 1, eigenAccuracy: 0, lift: 0 })
  })

  it('sums USD per variant', () => {
    expect(score.usd.eigen).toBeCloseTo(0.03, 10)
    expect(score.usd.noMemory).toBeCloseTo(0.006, 10)
    expect(score.usd.total).toBeCloseTo(0.036, 10)
  })

  it('throws when a question lacks one of the variants', () => {
    expect(() => scoreAnswers(rows.slice(0, 5), distance)).toThrow(/q3.*no-memory/)
  })

  it('throws on a duplicate (question, variant) row', () => {
    expect(() => scoreAnswers([...rows, rows[0]!], distance)).toThrow(/duplicate/)
  })

  it('throws when a question has no distance', () => {
    expect(() => scoreAnswers(rows, new Map([['q1', 1]]))).toThrow(/q2/)
  })

  it('throws on an empty result set', () => {
    expect(() => scoreAnswers([], distance)).toThrow(/no answer rows/)
  })
})
