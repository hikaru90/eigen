import type { AnswerRow } from './types'
import { describe, expect, it } from 'vitest'
import { scoreAnswers } from './score'
import { buildSummary, type SmokeBlock } from './summary'

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
    answerMode: 'compose' as const,
    evidenceOnly: false,
    smoke: [],
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

  it('records ingest capture, the answer mode and evidenceOnly=false, with no SMOKE marking', () => {
    expect(summary.config).toMatchObject({
      ingest: 'capture',
      answer: 'compose',
      evidenceOnly: false,
    })
    expect(summary.title).not.toMatch(/SMOKE/)
    expect(summary.title).toContain('answer compose')
    expect(summary.sections.map((s) => s.heading).join()).not.toMatch(/Smoke|SMOKE/)
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

describe('buildSummary --evidence-only', () => {
  const score = scoreAnswers([row('eigen', true), row('no-memory', false)], new Map([['q1', 100]]))
  const block: SmokeBlock = {
    questionId: 'q1',
    query: 'Suggest a drink?',
    preference: 'Drinks green tea',
    evidenceUserTurns: ['I only drink green tea.'],
    stored: [{ text: 'Drinks only green tea', createdAt: '2025-01-01T00:00:00.000Z' }],
    context: [{ text: 'Drinks only green tea', storedAt: '2025-01-01T00:00:00.000Z' }],
    askTools: ['answer_question'],
    askAnsweredWithoutMemory: false,
    correctAnswer: 'Green tea',
    eigenLetter: 'A',
    noMemoryLetter: 'C',
    correctLetter: 'A',
  }
  const build = (smoke: SmokeBlock[]) =>
    buildSummary({
      runId: 'r',
      chatModel: 'openai/gpt-4o-mini',
      startedAt: 'a',
      finishedAt: 'b',
      config: {},
      score,
      answerMode: 'ask',
      evidenceOnly: true,
      smoke,
      ingest: { usd: 0, captures: 1, personas: 1 },
      wallMsThisProcess: 1,
      gitSha: 'x',
      gitDirty: false,
    })

  it('marks title, config and the first section as a SMOKE run, not a benchmark score', () => {
    const summary = build([block])
    expect(summary.title).toMatch(/^SMOKE \(evidence-only\) - not a benchmark score/)
    expect(summary.title).toContain('ingest capture, answer ask')
    expect(summary.config).toMatchObject({ evidenceOnly: true, answer: 'ask' })
    expect(summary.sections[0]!.heading).toMatch(/SMOKE \(evidence-only\) - not a benchmark score/)
  })

  it('prints per question: preference, evidence, stored, Ask tools, context, picked vs correct', () => {
    const lines = build([block])
      .sections.find((s) => s.heading === 'Smoke: q1')!
      .lines!.join('\n')
    expect(lines).toContain('Drinks green tea')
    expect(lines).toContain('I only drink green tea.')
    expect(lines).toContain('Eigen stored (1)')
    expect(lines).toContain('[2025-01-01] Drinks only green tea')
    expect(lines).toContain('Ask answered with tools: answer_question')
    expect(lines).toContain('context the chooser saw (1)')
    expect(lines).toContain('eigen picked A (correct); no-memory picked C (wrong)')
  })

  it('flags an Ask answer that never called answer_question', () => {
    const lines = build([{ ...block, askTools: [], askAnsweredWithoutMemory: true, context: [] }])
      .sections.find((s) => s.heading === 'Smoke: q1')!
      .lines!.join('\n')
    expect(lines).toMatch(/NO answer_question call/)
  })

  it('requires smoke blocks', () => {
    expect(() => build([])).toThrow(/smoke blocks/)
  })
})
