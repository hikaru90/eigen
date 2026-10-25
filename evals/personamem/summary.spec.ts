import type { AnswerRow } from './types'
import { describe, expect, it } from 'vitest'
import { scoreAnswers } from './score'
import { buildSummary } from './summary'

const meta = { prefType: 'neutral', updated: false, who: 'self' }
function row(variant: AnswerRow['variant'], correct: boolean): AnswerRow {
  return {
    questionId: 'q1',
    personaId: 1,
    variant,
    ...meta,
    letter: 'A',
    correctLetter: correct ? 'A' : 'B',
    correct,
    usd: 0.01,
    ms: 10,
  }
}

describe('buildSummary', () => {
  const score = scoreAnswers([row('eigen', true), row('no-memory', false)], new Map([['q1', 100]]))
  const summary = buildSummary({
    runId: 'r1',
    chatModel: 'openai/gpt-4o-mini',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: '2026-10-25T11:00:00.000Z',
    config: { enrichConcurrency: 1 },
    score,
    ingest: { usd: 0.5, captures: 5, personas: 1 },
    wallMsThisProcess: 3_600_000,
    gitSha: 'abc123',
    gitDirty: false,
  })

  it('names the chat model in the title and carries the run metrics', () => {
    expect(summary.bench).toBe('personamem-v2')
    expect(summary.title).toContain('openai/gpt-4o-mini')
    expect(summary.metrics).toMatchObject({
      questions: 1,
      eigenAccuracy: 1,
      noMemoryAccuracy: 0,
      lift: 1,
      invalidLetters: 0,
    })
    expect(summary.config).toMatchObject({ gitSha: 'abc123', enrichConcurrency: 1 })
  })

  it('splits USD into ingest and answer', () => {
    expect(summary.metrics).toMatchObject({ ingestUsd: 0.5, answerUsd: 0.02, totalUsd: 0.52 })
  })

  it('includes breakdown tables and the paper reference lines', () => {
    const headings = summary.sections.map((s) => s.heading)
    expect(headings).toEqual(
      expect.arrayContaining([
        'Overall',
        'By pref_type',
        'By updated',
        'By who',
        'By distance (tokens)',
        'Decisions in effect',
        'Reference numbers (from the PersonaMem-v2 paper)',
      ]),
    )
    const reference = summary.sections.find((s) => s.heading.startsWith('Reference'))!
    expect(reference.lines!.join(' ')).toMatch(/37.*48%/)
    expect(reference.lines!.join(' ')).toMatch(/55%/)
    expect(reference.lines!.join(' ')).toMatch(/25%/)
  })
})
