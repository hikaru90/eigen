import type { AnswerRow } from './types'
import { describe, expect, it } from 'vitest'
import { scoreAnswers } from './score'
import { buildIncompleteSummary, buildSummary, formatScoreLines, type SmokeBlock } from './summary'

const meta = { prefType: 'neutral', updated: false, who: 'self' }
const retrievedItem = {
  id: 'a',
  normalizedText: 'Drinks only green tea',
  score: 0.5,
  createdAt: '2025-01-01T00:00:00.000Z',
}
function row(
  variant: AnswerRow['variant'],
  correct: boolean,
  retrieved = [retrievedItem],
): AnswerRow {
  return {
    ...(variant === 'eigen' ? { retrieved } : {}),
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
    split: 'benchmark' as const,
    score,
    answerMode: 'compose' as const,
    evidenceOnly: false,
    smoke: [],
    relevanceFloor: 'product' as const,
    reuseIngest: null,
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

  it('records the split in the config and the title', () => {
    expect(summary.config).toMatchObject({ split: 'benchmark' })
    expect(summary.title).toContain('benchmark split')
  })

  it('carries the evidence-retrieved rate and, per pref_type, accuracy, lift and the rate', () => {
    expect(summary.metrics).toMatchObject({ evidenceRetrieved: 1, evidenceRetrievedRate: 1 })
    expect(summary.metrics.byPrefType).toEqual({
      neutral: {
        n: 1,
        eigenAccuracy: 1,
        noMemoryAccuracy: 0,
        lift: 1,
        evidenceRetrievedRate: 1,
        meanContextSize: 1,
        evidenceQuestions: null,
        evidenceHitRate: null,
      },
    })
  })

  it('shows the evidence-retrieved rate in the overall and every breakdown table', () => {
    const overall = summary.sections.find((s) => s.heading === 'Overall')!
    expect(overall.table!.rows.map((r) => r[0])).toContain('evidence retrieved (context non-empty)')
    const byPref = summary.sections.find((s) => s.heading === 'By pref_type')!
    expect(byPref.table!.columns).toEqual([
      'pref_type',
      'n',
      'eigen',
      'no-memory',
      'lift',
      'evidence retrieved',
      'evidence hit',
      'mean context items',
    ])
    expect(byPref.table!.rows[0]).toEqual([
      'neutral',
      1,
      '100.0%',
      '0.0%',
      '+100.0 pp',
      '100.0%',
      'n/a',
      '1.0',
    ])
  })

  it('says outside evidence-only that a non-empty context is not necessarily evidence', () => {
    const overall = summary.sections.find((s) => s.heading === 'Overall')!
    expect(overall.lines!.join(' ')).toMatch(/not necessarily evidence/)
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

describe('buildSummary: relevance floor and history evidence', () => {
  const evidenceRow = (evidence: AnswerRow['evidence']) => ({ ...row('eigen', true), evidence })
  const build = (
    rows: AnswerRow[],
    over: { relevanceFloor?: 'product' | number; reuseIngest?: string | null } = {},
  ) =>
    buildSummary({
      runId: 'r',
      chatModel: 'deepseek/deepseek-v4.1-flash-1017',
      startedAt: 'a',
      finishedAt: 'b',
      config: {},
      split: 'val' as const,
      score: scoreAnswers(rows, new Map([['q1', 100]])),
      answerMode: 'ask',
      evidenceOnly: false,
      smoke: [],
      relevanceFloor: over.relevanceFloor ?? 'product',
      reuseIngest: over.reuseIngest ?? null,
      ingest: { usd: 0, captures: 0, personas: 0 },
      wallMsThisProcess: 1,
      gitSha: 'x',
      gitDirty: false,
    })
  const hitRows = [evidenceRow({ inHistory: true, items: 2, hit: true }), row('no-memory', false)]

  it('records the floor in the title, config and metrics: product resolves to the constant', () => {
    const product = build(hitRows)
    expect(product.title).toContain('floor product (0.22)')
    expect(product.config).toMatchObject({ relevanceFloor: 'product', relevanceFloorValue: 0.22 })
    expect(product.metrics).toMatchObject({ relevanceFloor: 'product', relevanceFloorValue: 0.22 })
    const lower = build(hitRows, { relevanceFloor: 0.15 })
    expect(lower.title).toContain('floor 0.15 (eval-only override)')
    expect(lower.config).toMatchObject({ relevanceFloor: 0.15, relevanceFloorValue: 0.15 })
    expect(lower.metrics).toMatchObject({ relevanceFloor: 0.15, relevanceFloorValue: 0.15 })
  })

  it('records which run the ingest was reused from', () => {
    expect(build(hitRows, { reuseIngest: 'run-a' }).config).toMatchObject({ reuseIngest: 'run-a' })
    expect(build(hitRows).config).toMatchObject({ reuseIngest: null })
  })

  it('carries evidence hit and mean context size in the metrics, overall and per pref_type', () => {
    const summary = build(hitRows)
    expect(summary.metrics).toMatchObject({
      evidenceQuestions: 1,
      evidenceHit: 1,
      evidenceHitRate: 1,
      meanContextSize: 1,
    })
    expect(summary.metrics.byPrefType).toEqual({
      neutral: expect.objectContaining({
        evidenceQuestions: 1,
        evidenceHitRate: 1,
        meanContextSize: 1,
      }),
    })
  })

  it('shows evidence hit and context size in the overall and breakdown tables', () => {
    const summary = build(hitRows)
    const overall = summary.sections.find((s) => s.heading === 'Overall')!
    expect(overall.table!.rows.map((r) => r[0])).toEqual(
      expect.arrayContaining([
        'evidence hit (history evidence in chooser context)',
        'mean context items',
      ]),
    )
    const byPref = summary.sections.find((s) => s.heading === 'By pref_type')!
    expect(byPref.table!.rows[0]!.slice(-2)).toEqual(['100.0% (1/1)', '1.0'])
  })

  it('marks a pref_type with no history evidence as n/a and says how many questions that is', () => {
    const summary = build([evidenceRow({ inHistory: false }), row('no-memory', false)])
    const byPref = summary.sections.find((s) => s.heading === 'By pref_type')!
    expect(byPref.table!.rows[0]!.slice(-2)).toEqual(['n/a (0 with history evidence)', '1.0'])
    const overall = summary.sections.find((s) => s.heading === 'Overall')!
    expect(overall.lines!.join(' ')).toMatch(/0 of 1 question\(s\) have evidence in the history/)
  })

  it('explains the evidence-hit definition in Decisions in effect', () => {
    const decisions = build(hitRows).sections.find((s) => s.heading === 'Decisions in effect')!
    expect(decisions.lines!.join(' ')).toMatch(/exact text.*split children.*notes linked/)
    expect(decisions.lines!.join(' ')).toMatch(/Relevance floor: product \(0\.22\)/)
  })

  it('an eval-only floor is called out as not a product setting', () => {
    const decisions = build(hitRows, { relevanceFloor: 0.1 }).sections.find(
      (s) => s.heading === 'Decisions in effect',
    )!
    expect(decisions.lines!.join(' ')).toMatch(/Relevance floor 0\.1.*eval-only/)
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
    prefType: 'neutral',
    belowFloor: { thoughts: 0.19, notePassages: null },
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
      split: 'val' as const,
      score,
      answerMode: 'ask',
      evidenceOnly: true,
      smoke,
      relevanceFloor: 'product' as const,
      reuseIngest: null,
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

  it('shows the split in the config and marks val as tuning data, not a reported score', () => {
    const summary = build([block])
    expect(summary.config).toMatchObject({ split: 'val' })
    expect(summary.title).toContain('val split')
    expect(
      summary.sections.find((s) => s.heading === 'Decisions in effect')!.lines!.join(' '),
    ).toMatch(/val split.*tuning/)
  })

  it('says per question what reached the chooser and the best candidate under the floor', () => {
    const hit = build([block])
      .sections.find((s) => s.heading === 'Smoke: q1')!
      .lines!.join('\n')
    expect(hit).toContain(
      'retrieval: 1 item(s) reached the chooser; best candidate under the 0.22 floor: thoughts 0.190, note passages none',
    )
  })

  it('tells "nothing retrieved, just below the floor" from "nothing retrieved, no candidate"', () => {
    const lines = (b: SmokeBlock) =>
      build([b])
        .sections.find((s) => s.heading === 'Smoke: q1')!
        .lines!.join('\n')
    const empty = { ...block, context: [], askAnsweredWithoutMemory: false }
    expect(lines({ ...empty, belowFloor: { thoughts: 0.19, notePassages: 0.04 } })).toContain(
      'retrieval: NOTHING reached the chooser; best candidate under the 0.22 floor: thoughts 0.190, note passages 0.040',
    )
    expect(lines({ ...empty, belowFloor: { thoughts: null, notePassages: null } })).toContain(
      'retrieval: NOTHING reached the chooser and no candidate fell under the 0.22 floor either (no candidate at all)',
    )
  })

  it('lists the misses with their pref_type, context size and below-floor scores', () => {
    const miss: SmokeBlock = {
      ...block,
      questionId: 'q2',
      prefType: 'ask_to_forget',
      context: [],
      eigenLetter: 'B',
      belowFloor: { thoughts: 0.18, notePassages: null },
    }
    const summary = build([block, miss])
    const misses = summary.sections.find((s) => s.heading === 'Eigen misses (evidence-only)')!
    expect(misses.table!.columns).toEqual([
      'question',
      'pref_type',
      'context items',
      'best under floor: thoughts',
      'best under floor: note passages',
    ])
    expect(misses.table!.rows).toEqual([['q2', 'ask_to_forget', 0, '0.180', 'none']])
  })

  it('has no misses section when Eigen got every question right', () => {
    expect(build([block]).sections.some((s) => s.heading === 'Eigen misses (evidence-only)')).toBe(
      false,
    )
  })

  it('names the overridden floor in the retrieval line', () => {
    const lowered = buildSummary({
      runId: 'r',
      chatModel: 'openai/gpt-4o-mini',
      startedAt: 'a',
      finishedAt: 'b',
      config: {},
      split: 'val' as const,
      score,
      answerMode: 'ask',
      evidenceOnly: true,
      smoke: [block],
      relevanceFloor: 0.15,
      reuseIngest: null,
      ingest: { usd: 0, captures: 1, personas: 1 },
      wallMsThisProcess: 1,
      gitSha: 'x',
      gitDirty: false,
    })
    expect(lowered.sections.find((s) => s.heading === 'Smoke: q1')!.lines!.join('\n')).toContain(
      'best candidate under the 0.15 floor',
    )
  })

  it('requires smoke blocks', () => {
    expect(() => build([])).toThrow(/smoke blocks/)
  })
})

describe('formatScoreLines', () => {
  const score = scoreAnswers([row('eigen', true), row('no-memory', false)], new Map([['q1', 100]]))

  it('prints the floor and both metrics overall and per pref_type, for the console at the end of a run', () => {
    expect(formatScoreLines(score, 'product')).toEqual([
      'relevance floor: product (0.22)',
      'eigen 100.0%, no-memory 0.0%, lift +100.0 pp; evidence retrieved 100.0% (1/1); mean context 1.0 item(s)',
      '  neutral: n=1 eigen 100.0%, no-memory 0.0%, lift +100.0 pp, evidence retrieved 100.0%, mean context 1.0',
    ])
  })

  it('adds the evidence-hit rate on full-history runs', () => {
    const withEvidence = scoreAnswers(
      [
        { ...row('eigen', true), evidence: { inHistory: true, items: 2, hit: true } },
        row('no-memory', false),
      ],
      new Map([['q1', 100]]),
    )
    const lines = formatScoreLines(withEvidence, 0.15)
    expect(lines[0]).toBe('relevance floor: 0.15 (eval-only override)')
    expect(lines[1]).toContain('evidence hit 100.0% (1/1)')
    expect(lines[2]).toContain('evidence hit 100.0% (1/1)')
  })
})

describe('rehearsal and incomplete summaries', () => {
  const score = scoreAnswers([row('eigen', true), row('no-memory', false)], new Map([['q1', 100]]))
  const base = {
    runId: 'r1',
    chatModel: 'openai/gpt-4o-mini',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: '2026-10-25T11:00:00.000Z',
    config: { enrichConcurrency: 1 },
    split: 'val' as const,
    score,
    answerMode: 'compose' as const,
    evidenceOnly: false,
    smoke: [],
    relevanceFloor: 'product' as const,
    reuseIngest: null,
    ingest: { usd: 0.5, captures: 5, personas: 1 },
    wallMsThisProcess: 1,
    gitSha: 'abc123',
    gitDirty: false,
  }

  it('a rehearsal run is labelled "not a score" in the title, the config and a banner section', () => {
    const summary = buildSummary({ ...base, rehearsal: { maxHistoryTurns: 12 } })
    expect(summary.title).toMatch(/^REHEARSAL - not a score - /)
    expect(summary.config).toMatchObject({ rehearsalMaxHistoryTurns: 12 })
    expect(summary.sections[0]).toMatchObject({ heading: 'REHEARSAL - not a score' })
    expect(summary.sections[0]!.lines!.join(' ')).toContain('first 12 user turn(s)')
  })

  it('a normal run carries no rehearsal label and says it is complete', () => {
    const summary = buildSummary(base)
    expect(summary.title).not.toMatch(/REHEARSAL/)
    expect(summary.metrics).toMatchObject({ complete: true })
  })

  const incompleteInput = {
    runId: 'r1',
    chatModel: 'openai/gpt-4o-mini',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: '2026-10-25T11:00:00.000Z',
    split: 'val' as const,
    answerMode: 'ask' as const,
    questions: { planned: 6, answered: 4 },
    missingQuestions: ['p1-aaaaaaaaaaaa', 'p2-bbbbbbbbbbbb'],
    openFailures: [
      { at: 't', tenant: 't1', phase: 'ingest', error: 'tenant 1 exploded' },
      { at: 't', tenant: 't2', questionId: 'p2-bbbbbbbbbbbb', phase: 'answer', error: 'bad answer' },
    ],
    stopped: false,
    resumeCommand: 'npm run eval:personamem -- --resume --run-id r1',
    rehearsal: null,
  }

  it('an incomplete summary says so everywhere, lists failures and what is missing, and computes no score', () => {
    const summary = buildIncompleteSummary(incompleteInput)
    expect(summary.title).toMatch(/^INCOMPLETE - /)
    expect(summary.metrics).toMatchObject({ complete: false, questionsPlanned: 6, questionsAnswered: 4 })
    expect(summary.metrics).not.toHaveProperty('eigenAccuracy')
    const text = JSON.stringify(summary.sections)
    expect(text).toContain('tenant 1 exploded')
    expect(text).toContain('p2-bbbbbbbbbbbb')
    expect(text).toContain('npm run eval:personamem -- --resume --run-id r1')
    expect(summary.sections[0]).toMatchObject({ heading: 'INCOMPLETE - no score' })
  })

  it('a stopped run is incomplete with the stop named', () => {
    const summary = buildIncompleteSummary({ ...incompleteInput, stopped: true, openFailures: [] })
    expect(JSON.stringify(summary.sections)).toMatch(/stopped by a signal/)
  })
})
