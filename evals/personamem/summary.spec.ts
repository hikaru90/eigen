import type { AnswerRow, AskTurnRecord } from './types'
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
    ingestMode: 'capture' as const,
    askTurns: [],
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

  it('capture mode has no Ask section and says which ingest it used', () => {
    expect(summary.sections.map((s) => s.heading)).not.toContain('Ask ingest')
    expect(summary.config).toMatchObject({ ingest: 'capture' })
    expect(summary.metrics).not.toHaveProperty('askTurns')
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

describe('buildSummary in ask mode', () => {
  const turn = (over: Partial<AskTurnRecord>): AskTurnRecord => ({
    personaId: 1,
    tenantUserId: 'public-bench-personamem-v2-ask-gpt-4o-mini-p1',
    turn: 0,
    clock: '2025-01-01T00:00:00.000Z',
    captures: 0,
    deletes: 0,
    toolNames: [],
    thoughtsCreated: 0,
    clockMismatches: 0,
    askUsd: 0.004,
    enrichUsd: 0,
    usd: 0.004,
    ms: 100,
    ...over,
  })
  const askTurns = [
    turn({ turn: 0, captures: 2, thoughtsCreated: 2, askUsd: 0.01, enrichUsd: 0.004, usd: 0.014 }),
    turn({ turn: 1 }),
    turn({
      turn: 2,
      deletes: 1,
      captures: 1,
      thoughtsCreated: 1,
      clockMismatches: 1,
      enrichUsd: 0.002,
      usd: 0.006,
    }),
    turn({
      personaId: 2,
      tenantUserId: 'public-bench-personamem-v2-ask-gpt-4o-mini-p2',
      turn: 0,
      captures: 1,
      thoughtsCreated: 1,
      askUsd: 0.006,
      enrichUsd: 0.001,
      usd: 0.007,
    }),
  ]
  const score = scoreAnswers([row('eigen', true), row('no-memory', false)], new Map([['q1', 100]]))
  const summary = buildSummary({
    runId: 'r1',
    chatModel: 'openai/gpt-4o-mini',
    startedAt: 'a',
    finishedAt: 'b',
    config: {},
    score,
    ingestMode: 'ask',
    askTurns,
    ingest: { usd: 0.031, captures: 4, personas: 2 },
    wallMsThisProcess: 1,
    gitSha: 'x',
    gitDirty: false,
  })

  it('totals turns, captures, turns with a capture, deletes, USD split and clock mismatches', () => {
    expect(summary.metrics).toMatchObject({
      askTurns: 4,
      askCaptures: 4,
      askTurnsWithCapture: 3,
      askDeletes: 1,
      askClockMismatches: 1,
    })
    expect(summary.metrics.askTurnUsd).toBeCloseTo(0.024, 9)
    expect(summary.metrics.askEnrichUsd).toBeCloseTo(0.007, 9)
    expect(summary.config).toMatchObject({ ingest: 'ask' })
  })

  it('has an Ask ingest table with one row per persona plus a total row', () => {
    const section = summary.sections.find((s) => s.heading === 'Ask ingest')!
    expect(section.table!.columns).toEqual([
      'persona',
      'user turns replayed',
      'captures',
      'turns with a capture',
      'deletes',
      'thoughts created',
      'clock mismatches',
      'ask USD',
      'enrich USD',
    ])
    expect(section.table!.rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[6]])).toEqual([
      [1, 3, 3, 2, 1, 1],
      [2, 1, 1, 1, 0, 0],
      ['total', 4, 4, 3, 1, 1],
    ])
    expect(section.lines!.join(' ')).toMatch(/createdAt differs from the turn clock/)
  })

  it('states that captured_at is not forced and ask mode replaces the capture decision text', () => {
    const decisions = summary.sections.find((s) => s.heading === 'Decisions in effect')!
    expect(decisions.lines!.join(' ')).toMatch(/Ask/)
    expect(decisions.lines!.join(' ')).not.toMatch(/one capture per user turn/)
  })

  it('refuses ask mode without turn records', () => {
    expect(() =>
      buildSummary({
        runId: 'r',
        chatModel: 'm',
        startedAt: 'a',
        finishedAt: 'b',
        config: {},
        score,
        ingestMode: 'ask',
        askTurns: [],
        ingest: { usd: 0, captures: 0, personas: 0 },
        wallMsThisProcess: 1,
        gitSha: 'x',
        gitDirty: false,
      }),
    ).toThrow(/ask-turns/)
  })
})
