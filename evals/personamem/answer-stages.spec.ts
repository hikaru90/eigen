import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  appendStage,
  completedStageRows,
  loadAnswerStages,
  nextStage,
  type EigenStage,
} from './answer-stages'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'answer-stages-'))
  file = join(dir, 'answer-stages.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const eigen: Omit<EigenStage, 'type' | 'at'> = {
  questionId: 'p1-aaaaaaaaaaaa',
  answerText: 'You like tea.',
  retrieved: [
    { id: 't1', normalizedText: 'Drinks tea', score: 0.5, createdAt: '2025-01-01T00:00:00.000Z' },
  ],
  citedIds: [],
  belowFloor: { thoughts: 0.2 },
  askTools: ['answer_question'],
  askAnsweredWithoutMemory: false,
  evidence: { inHistory: true, items: 2, hit: true },
  usd: 0.01,
  ms: 100,
}

describe('answer-stages.jsonl', () => {
  it('a missing file is no stages; the first stage to run is eigen', () => {
    const stages = loadAnswerStages(file)
    expect(stages.size).toBe(0)
    expect(nextStage(stages.get('p1-aaaaaaaaaaaa'))).toBe('eigen')
  })

  it('walks eigen -> choose-eigen -> choose-no-memory -> complete', () => {
    appendStage(file, { type: 'eigen', ...eigen })
    expect(nextStage(loadAnswerStages(file).get(eigen.questionId))).toBe('choose-eigen')
    appendStage(file, {
      type: 'choose-eigen',
      questionId: eigen.questionId,
      letter: 'B',
      usd: 0.002,
      ms: 10,
    })
    expect(nextStage(loadAnswerStages(file).get(eigen.questionId))).toBe('choose-no-memory')
    appendStage(file, {
      type: 'choose-no-memory',
      questionId: eigen.questionId,
      letter: 'C',
      usd: 0.001,
      ms: 5,
    })
    expect(nextStage(loadAnswerStages(file).get(eigen.questionId))).toBe('complete')
  })

  it('the eigen stage keeps the Ask answer, tools, context, below-floor and evidence', () => {
    appendStage(file, { type: 'eigen', ...eigen })
    const stored = loadAnswerStages(file).get(eigen.questionId)!.eigen!
    expect(stored).toMatchObject(eigen)
  })

  it('completedStageRows hands out the three stages only when all exist', () => {
    appendStage(file, { type: 'eigen', ...eigen })
    expect(completedStageRows(loadAnswerStages(file).get(eigen.questionId))).toBeNull()
    appendStage(file, {
      type: 'choose-eigen',
      questionId: eigen.questionId,
      letter: 'B',
      usd: 0,
      ms: 1,
    })
    appendStage(file, {
      type: 'choose-no-memory',
      questionId: eigen.questionId,
      letter: 'C',
      usd: 0,
      ms: 1,
    })
    const done = completedStageRows(loadAnswerStages(file).get(eigen.questionId))!
    expect(done.chooseEigen.letter).toBe('B')
    expect(done.chooseNoMemory.letter).toBe('C')
  })

  it('stages of different questions are kept apart', () => {
    appendStage(file, { type: 'eigen', ...eigen })
    appendStage(file, { type: 'eigen', ...eigen, questionId: 'p2-bbbbbbbbbbbb' })
    appendStage(file, {
      type: 'choose-eigen',
      questionId: 'p2-bbbbbbbbbbbb',
      letter: 'A',
      usd: 0,
      ms: 1,
    })
    const stages = loadAnswerStages(file)
    expect(nextStage(stages.get(eigen.questionId))).toBe('choose-eigen')
    expect(nextStage(stages.get('p2-bbbbbbbbbbbb'))).toBe('choose-no-memory')
  })

  it.each([
    ['a stage stored twice', ['eigen', 'eigen']],
    ['choose-eigen without eigen', ['choose-eigen']],
    ['choose-no-memory before choose-eigen', ['eigen', 'choose-no-memory']],
  ])('fails loud on %s', (_name, order) => {
    for (const type of order) {
      if (type === 'eigen') appendStage(file, { type: 'eigen', ...eigen })
      else
        appendStage(file, {
          type: type as 'choose-eigen' | 'choose-no-memory',
          questionId: eigen.questionId,
          letter: 'A',
          usd: 0,
          ms: 1,
        })
    }
    expect(() => loadAnswerStages(file)).toThrow(/answer-stages\.jsonl.*damaged/s)
  })

  it('refuses a row that does not match the schema', () => {
    writeFileSync(file, `${JSON.stringify({ type: 'eigen', questionId: 'x' })}\n`)
    expect(() => loadAnswerStages(file)).toThrow(/answer-stages\.jsonl/)
  })

  it('never writes a vector field', () => {
    appendStage(file, { type: 'eigen', ...eigen })
    expect(readFileSync(file, 'utf8')).not.toMatch(/embedding|vector/i)
  })
})
