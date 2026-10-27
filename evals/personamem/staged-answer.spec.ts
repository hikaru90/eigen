import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readJsonl } from '../public-bench/run-output'
import { appendStage, loadAnswerStages } from './answer-stages'
import { answerStaged, healLoneVariants, type EigenOutcome } from './staged-answer'
import { answerRowSchema } from './types'

let dir: string
let stagesPath: string
let answersPath: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'staged-answer-'))
  stagesPath = join(dir, 'answer-stages.jsonl')
  answersPath = join(dir, 'answers.jsonl')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const question = {
  questionId: 'p1-aaaaaaaaaaaa',
  personaId: 1,
  prefType: 'neutral',
  updated: false,
  who: 'self',
  correctLetter: 'B' as const,
}

const eigenOutcome: EigenOutcome = {
  answerText: 'You like tea.',
  retrieved: [
    { id: 't1', normalizedText: 'Drinks tea', score: 0.5, createdAt: '2025-01-01T00:00:00.000Z' },
  ],
  citedIds: ['t1'],
  belowFloor: { thoughts: null },
  askTools: ['answer_question'],
  askAnsweredWithoutMemory: false,
  evidence: { inHistory: true, items: 1, hit: true },
}

function deps() {
  let spend = 0
  return {
    runEigen: vi.fn(async () => {
      spend += 0.01
      return eigenOutcome
    }),
    runChooseEigen: vi.fn(async () => {
      spend += 0.002
      return 'B' as const
    }),
    runChooseNoMemory: vi.fn(async () => {
      spend += 0.001
      return 'C' as const
    }),
    spend: vi.fn(async () => spend),
  }
}

const run = (d: ReturnType<typeof deps>) =>
  answerStaged({
    question,
    paths: { stages: stagesPath, answers: answersPath },
    stages: loadAnswerStages(stagesPath).get(question.questionId),
    ...d,
  })

describe('answerStaged', () => {
  it('runs the three stages in order, stores each, and writes the final rows last', async () => {
    const d = deps()
    await run(d)

    expect(readJsonl(stagesPath).map((r) => r.type)).toEqual([
      'eigen',
      'choose-eigen',
      'choose-no-memory',
    ])
    const rows = readJsonl(answersPath).map((r) => answerRowSchema.parse(r))
    expect(rows.map((r) => r.variant)).toEqual(['eigen', 'no-memory'])
    expect(rows[0]).toMatchObject({
      letter: 'B',
      correct: true,
      eigenAnswer: 'You like tea.',
      citedIds: ['t1'],
      askTools: ['answer_question'],
      evidence: { inHistory: true, items: 1, hit: true },
    })
    expect(rows[0]!.usd).toBeCloseTo(0.012, 6)
    expect(rows[1]).toMatchObject({ letter: 'C', correct: false })
    expect(rows[1]!.usd).toBeCloseTo(0.001, 6)
  })

  it('the chooser gets the stored eigen stage', async () => {
    const d = deps()
    await run(d)
    expect(d.runChooseEigen).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'eigen', answerText: 'You like tea.' }),
    )
  })

  it('resumes after the eigen stage without recomputing it', async () => {
    const d = deps()
    appendStage(stagesPath, {
      type: 'eigen',
      questionId: question.questionId,
      ...eigenOutcome,
      usd: 0.01,
      ms: 5,
    })

    await run(d)

    expect(d.runEigen).not.toHaveBeenCalled()
    expect(d.runChooseEigen).toHaveBeenCalledTimes(1)
    expect(d.runChooseNoMemory).toHaveBeenCalledTimes(1)
    expect(readJsonl(answersPath)).toHaveLength(2)
  })

  it('resumes after choose-eigen with only the no-memory chooser left', async () => {
    const d = deps()
    appendStage(stagesPath, {
      type: 'eigen',
      questionId: question.questionId,
      ...eigenOutcome,
      usd: 0.01,
      ms: 5,
    })
    appendStage(stagesPath, {
      type: 'choose-eigen',
      questionId: question.questionId,
      letter: 'A',
      usd: 0.002,
      ms: 2,
    })

    await run(d)

    expect(d.runEigen).not.toHaveBeenCalled()
    expect(d.runChooseEigen).not.toHaveBeenCalled()
    expect(d.runChooseNoMemory).toHaveBeenCalledTimes(1)
    const rows = readJsonl(answersPath).map((r) => answerRowSchema.parse(r))
    expect(rows[0]).toMatchObject({ letter: 'A', correct: false }) // the stored letter, not a new one
  })

  it('with all three stages stored it only writes the final rows (no call at all)', async () => {
    const d = deps()
    appendStage(stagesPath, {
      type: 'eigen',
      questionId: question.questionId,
      ...eigenOutcome,
      usd: 0.01,
      ms: 5,
    })
    appendStage(stagesPath, {
      type: 'choose-eigen',
      questionId: question.questionId,
      letter: 'B',
      usd: 0.002,
      ms: 2,
    })
    appendStage(stagesPath, {
      type: 'choose-no-memory',
      questionId: question.questionId,
      letter: 'C',
      usd: 0.001,
      ms: 1,
    })

    await run(d)

    expect(d.runEigen).not.toHaveBeenCalled()
    expect(d.runChooseEigen).not.toHaveBeenCalled()
    expect(d.runChooseNoMemory).not.toHaveBeenCalled()
    expect(d.spend).not.toHaveBeenCalled()
    expect(readJsonl(answersPath)).toHaveLength(2)
  })

  it('writes no final row while a stage fails, and the stored stages survive for the retry', async () => {
    const d = deps()
    d.runChooseEigen.mockRejectedValueOnce(new Error('chooser exploded'))

    await expect(run(d)).rejects.toThrow('chooser exploded')

    expect(readJsonl(answersPath)).toEqual([])
    expect(readJsonl(stagesPath).map((r) => r.type)).toEqual(['eigen'])

    const retry = deps()
    await run(retry)
    expect(retry.runEigen).not.toHaveBeenCalled()
    expect(readJsonl(answersPath)).toHaveLength(2)
  })

  it('refuses to answer a question twice', async () => {
    const d = deps()
    await run(d)
    await expect(run(deps())).rejects.toThrow(/already answered/)
    expect(readJsonl(answersPath)).toHaveLength(2)
  })
})

describe('healLoneVariants', () => {
  const row = (variant: 'eigen' | 'no-memory', questionId = 'p1-aaaaaaaaaaaa') => ({
    questionId,
    personaId: 1,
    variant,
    prefType: 'neutral',
    updated: false,
    who: 'self',
    letter: 'A',
    correctLetter: 'A',
    correct: true,
    usd: 0,
    ms: 0,
  })

  it('drops a question that has only one variant (the stages still hold its data) and reports it', async () => {
    const { appendJsonl } = await import('../public-bench/run-output')
    appendJsonl(answersPath, row('eigen'))
    appendJsonl(answersPath, row('eigen', 'p2-bbbbbbbbbbbb'))
    appendJsonl(answersPath, row('no-memory', 'p2-bbbbbbbbbbbb'))

    expect(healLoneVariants(answersPath, new Set(['p1-aaaaaaaaaaaa']))).toEqual(['p1-aaaaaaaaaaaa'])
    expect(readJsonl(answersPath).map((r) => r.questionId)).toEqual([
      'p2-bbbbbbbbbbbb',
      'p2-bbbbbbbbbbbb',
    ])
  })

  it('refuses to guess when the lone variant has no complete stages behind it', async () => {
    const { appendJsonl } = await import('../public-bench/run-output')
    appendJsonl(answersPath, row('eigen'))
    expect(() => healLoneVariants(answersPath, new Set())).toThrow(/only \[eigen\].*damaged/s)
  })

  it('leaves a clean file alone', async () => {
    const { appendJsonlRows } = await import('../public-bench/run-output')
    appendJsonlRows(answersPath, [row('eigen'), row('no-memory')])
    expect(healLoneVariants(answersPath, new Set())).toEqual([])
  })
})
