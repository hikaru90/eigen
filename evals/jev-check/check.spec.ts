import type { CaptureAuditFixtureFile, CaptureReasonFixtureFile, FixtureFile } from './fixtures'
import { describe, expect, it, vi } from 'vitest'
import { buildCaptureAuditRequest } from '$lib/server/capture-review/audit-questions'
import { buildCaptureReasonRequest } from '$lib/server/capture-review/reason-question'
import type { DecisionRequest, DecisionResponse } from '$lib/server/llm/decision-client'
import { LOW_PROBABILITY, filterFixtures, prepareCases, runChecks, type Decide } from './check'

const AUDIT_INPUT = {
  capturedAt: '2026-10-27T10:00:00+01:00',
  timezone: 'Europe/Berlin',
  rawText: 'Call Mom on Friday',
  storedText: 'Call Mom on Friday',
  names: [{ ref: 'n1', surface: 'Mom' }],
  dates: [{ ref: 'd1', event: 'Call Mom', when: 'Friday 30 October 2026' }],
  pieces: [],
}

const REASON_INPUT = {
  rawText: 'Idea: a podcast about old maps',
  storedSummary: 'Saved as a task',
  reason: 'this is an idea, not a todo',
}

function fixtureSet(): {
  audit: CaptureAuditFixtureFile
  reason: CaptureReasonFixtureFile
  files: FixtureFile[]
} {
  const audit: CaptureAuditFixtureFile = {
    kind: 'capture_audit',
    cases: [
      {
        id: 'a1',
        note: 'clean',
        input: AUDIT_INPUT,
        expected: { 'name:n1': 'right', missing_names: 'none_missing', 'date:d1': 'right' },
      },
      {
        id: 'a2',
        input: { ...AUDIT_INPUT, dates: [] },
        expected: { 'name:n1': 'right', missing_names: 'none_missing' },
      },
    ],
  }
  const reason: CaptureReasonFixtureFile = {
    kind: 'capture_reason',
    cases: [{ id: 'r1', input: REASON_INPUT, expected: { reason: 'wrong_category' } }],
  }
  return { audit, reason, files: [audit, reason] }
}

function fixtures(): FixtureFile[] {
  return fixtureSet().files
}

type Script = Record<string, { choice: string; probability: number }>

/** A fake Jev: answers every question of the request from `script` (default: the first criterion at 0.95). */
function fakeDecide(script: Script = {}, costs: Array<number | null> = []) {
  let call = 0
  const decide = vi.fn(async (request: DecisionRequest): Promise<DecisionResponse> => {
    const answers: DecisionResponse['answers'] = {}
    for (const [id, question] of Object.entries(request.questions)) {
      const labels = Object.keys(question.criteria)
      const scripted = script[id] ?? { choice: labels[0], probability: 0.95 }
      const probabilities: Record<string, number> = {}
      for (const label of labels)
        probabilities[label] = (1 - scripted.probability) / (labels.length - 1 || 1)
      probabilities[scripted.choice] = scripted.probability
      answers[id] = {
        type: 'choice',
        choice: scripted.choice,
        probabilities,
        confidence: scripted.probability,
      }
    }
    const reportedCostUsd = call < costs.length ? costs[call] : 0.0001
    call += 1
    return {
      model: 'fake/jev',
      answers,
      usage: { input_tokens: 1, output_tokens: 1 },
      reportedCostUsd,
    }
  })
  return decide as typeof decide & Decide
}

/** The script that makes the fake agree with every fixture label. */
const AGREE: Script = {
  'name:n1': { choice: 'right', probability: 0.95 },
  missing_names: { choice: 'none_missing', probability: 0.95 },
  'date:d1': { choice: 'right', probability: 0.95 },
  reason: { choice: 'wrong_category', probability: 0.95 },
}

describe('prepareCases', () => {
  it('builds each request with the production builders', () => {
    const prepared = prepareCases(fixtures())
    expect(prepared.map((c) => [c.kind, c.id])).toEqual([
      ['capture_audit', 'a1'],
      ['capture_audit', 'a2'],
      ['capture_reason', 'r1'],
    ])
    expect(prepared[0].request).toEqual(buildCaptureAuditRequest(AUDIT_INPUT))
    expect(prepared[2].request).toEqual(buildCaptureReasonRequest(REASON_INPUT))
    expect(prepared[0].note).toBe('clean')
    expect(prepared[1].note).toBeNull()
  })

  it('fails loud when expected lacks a question the builder asks, naming case and question', () => {
    const { audit, files } = fixtureSet()
    delete audit.cases[0].expected.missing_names
    expect(() => prepareCases(files)).toThrow(/a1.*missing_names/s)
  })

  it('fails loud when expected has a question the builder did not ask', () => {
    const { audit, files } = fixtureSet()
    audit.cases[1].expected['date:d9'] = 'right'
    expect(() => prepareCases(files)).toThrow(/a2.*date:d9/s)
  })

  it('fails loud when a wording label is expected but the texts are the same (no wording question)', () => {
    const { audit, files } = fixtureSet()
    audit.cases[0].expected.wording = 'right'
    expect(() => prepareCases(files)).toThrow(/a1.*wording/s)
  })

  it('fails loud when a label is not one of the question criteria, listing the valid ones', () => {
    const { audit, files } = fixtureSet()
    audit.cases[0].expected['name:n1'] = 'correct'
    expect(() => prepareCases(files)).toThrow(/a1.*name:n1.*"correct".*right, wrong/s)
  })

  it('fails loud on a duplicate case id, even across kinds', () => {
    const { reason, files } = fixtureSet()
    reason.cases[0].id = 'a1'
    expect(() => prepareCases(files)).toThrow(/duplicate case id "a1"/)
  })

  it('lets builder validation errors through (an invalid fixture input)', () => {
    const { audit, files } = fixtureSet()
    audit.cases[0].input = { ...AUDIT_INPUT, rawText: ' ' }
    expect(() => prepareCases(files)).toThrow('rawText must not be empty')
  })
})

describe('filterFixtures', () => {
  it('keeps everything with no filter', () => {
    expect(filterFixtures(fixtures(), { kind: null, caseIds: [] })).toEqual(fixtures())
  })

  it('filters by kind', () => {
    const out = filterFixtures(fixtures(), { kind: 'capture_reason', caseIds: [] })
    expect(out.map((f) => f.kind)).toEqual(['capture_reason'])
  })

  it('filters by case id, across kinds, keeping fixture order', () => {
    const out = filterFixtures(fixtures(), { kind: null, caseIds: ['r1', 'a2'] })
    expect(out.map((f) => f.cases.map((c) => c.id))).toEqual([['a2'], ['r1']])
  })

  it('fails loud on an unknown case id, listing what exists', () => {
    expect(() => filterFixtures(fixtures(), { kind: null, caseIds: ['zzz'] })).toThrow(
      /unknown case "zzz".*a1, a2, r1/s,
    )
  })

  it('fails loud when a case is not of the requested kind', () => {
    expect(() => filterFixtures(fixtures(), { kind: 'capture_audit', caseIds: ['r1'] })).toThrow(
      /unknown case "r1"/,
    )
  })
})

describe('runChecks', () => {
  it('asks Jev once per case with all its questions, using the built request', async () => {
    const decide = fakeDecide(AGREE)
    await runChecks({ fixtures: fixtures(), decide })
    expect(decide).toHaveBeenCalledTimes(3)
    expect(decide.mock.calls[0][0]).toEqual(buildCaptureAuditRequest(AUDIT_INPUT))
    expect(Object.keys(decide.mock.calls[0][0].questions)).toEqual([
      'name:n1',
      'missing_names',
      'date:d1',
    ])
    expect(decide.mock.calls[2][0]).toEqual(buildCaptureReasonRequest(REASON_INPUT))
  })

  it('marks agreement at high probability ok, with the probability of the chosen label', async () => {
    const result = await runChecks({ fixtures: fixtures(), decide: fakeDecide(AGREE) })
    expect(result.rows[0]).toEqual({
      caseId: 'a1',
      questionId: 'name:n1',
      expected: 'right',
      choice: 'right',
      probability: 0.95,
      status: 'ok',
    })
    expect(result.totals).toEqual({ questions: 6, ok: 6, low: 0, mismatch: 0 })
  })

  it('marks agreement below 0.8 low, and exactly 0.8 ok', async () => {
    expect(LOW_PROBABILITY).toBe(0.8)
    const result = await runChecks({
      fixtures: fixtures(),
      decide: fakeDecide({
        ...AGREE,
        'name:n1': { choice: 'right', probability: 0.79 },
        'date:d1': { choice: 'right', probability: 0.8 },
        reason: { choice: 'wrong_category', probability: 0.51 },
      }),
    })
    const status = (caseId: string, questionId: string) =>
      result.rows.find((r) => r.caseId === caseId && r.questionId === questionId)?.status
    expect(status('a1', 'name:n1')).toBe('low')
    expect(status('a1', 'date:d1')).toBe('ok')
    expect(status('r1', 'reason')).toBe('low')
    expect(result.totals.low).toBe(3) // name:n1 in a1 and a2, reason in r1
  })

  it('marks disagreement mismatch whatever the probability', async () => {
    const result = await runChecks({
      fixtures: fixtures(),
      decide: fakeDecide({
        ...AGREE,
        'date:d1': { choice: 'wrong', probability: 0.99 },
        reason: { choice: 'other', probability: 0.55 },
      }),
    })
    const row = result.rows.find((r) => r.caseId === 'a1' && r.questionId === 'date:d1')
    expect(row).toMatchObject({
      expected: 'right',
      choice: 'wrong',
      probability: 0.99,
      status: 'mismatch',
    })
    expect(result.rows.find((r) => r.caseId === 'r1')).toMatchObject({
      choice: 'other',
      status: 'mismatch',
    })
    expect(result.totals).toEqual({ questions: 6, ok: 4, low: 0, mismatch: 2 })
  })

  it('groups rows by case in fixture order and keeps note, kind and request', async () => {
    const result = await runChecks({ fixtures: fixtures(), decide: fakeDecide(AGREE) })
    expect(result.cases.map((c) => [c.kind, c.caseId, c.note, c.rows.length])).toEqual([
      ['capture_audit', 'a1', 'clean', 3],
      ['capture_audit', 'a2', null, 2],
      ['capture_reason', 'r1', null, 1],
    ])
    expect(result.cases[0].request).toEqual(buildCaptureAuditRequest(AUDIT_INPUT))
    expect(result.rows).toEqual(result.cases.flatMap((c) => c.rows))
  })

  it('sums the provider-reported cost per call and counts calls without one', async () => {
    const result = await runChecks({
      fixtures: fixtures(),
      decide: fakeDecide(AGREE, [0.0001, 0.0002, null]),
    })
    expect(result.reportedCostUsd).toBeCloseTo(0.0003, 10)
    expect(result.callsWithoutReportedCost).toBe(1)
    expect(result.cases.map((c) => c.reportedCostUsd)).toEqual([0.0001, 0.0002, null])
  })

  it('records which model answered', async () => {
    const result = await runChecks({ fixtures: fixtures(), decide: fakeDecide(AGREE) })
    expect(result.models).toEqual(['fake/jev'])
    expect(result.cases.every((c) => c.model === 'fake/jev')).toBe(true)
  })

  it('reports each case as soon as it is done', async () => {
    const seen: string[] = []
    await runChecks({
      fixtures: fixtures(),
      decide: fakeDecide(AGREE),
      onCase: (c) => seen.push(c.caseId),
    })
    expect(seen).toEqual(['a1', 'a2', 'r1'])
  })

  it('makes no call when the fixtures are invalid (expected keys are checked first)', async () => {
    const { reason, files } = fixtureSet()
    reason.cases[0].expected = { wrong_key: 'wrong_category' }
    const decide = fakeDecide(AGREE)
    await expect(runChecks({ fixtures: files, decide })).rejects.toThrow(/r1.*wrong_key/s)
    expect(decide).not.toHaveBeenCalled()
  })

  it('fails loud when Jev answers a label outside the criteria, naming case and question', async () => {
    const decide = fakeDecide({ ...AGREE, 'name:n1': { choice: 'maybe', probability: 0.9 } })
    await expect(runChecks({ fixtures: fixtures(), decide })).rejects.toThrow(
      /a1.*name:n1.*"maybe"/s,
    )
  })

  it('fails loud when the response lacks an answer for a question', async () => {
    const decide: Decide = async () => ({
      model: 'fake',
      answers: {},
      usage: { input_tokens: 0, output_tokens: 0 },
      reportedCostUsd: 0,
    })
    await expect(runChecks({ fixtures: fixtures(), decide })).rejects.toThrow(
      /a1.*name:n1.*no answer/s,
    )
  })

  it('fails loud when the chosen label has no probability', async () => {
    const decide: Decide = async (request) => ({
      model: 'fake',
      answers: Object.fromEntries(
        Object.keys(request.questions).map((id) => [
          id,
          { type: 'choice' as const, choice: 'right', probabilities: { wrong: 1 }, confidence: 1 },
        ]),
      ),
      usage: { input_tokens: 0, output_tokens: 0 },
      reportedCostUsd: 0,
    })
    await expect(runChecks({ fixtures: fixtures(), decide })).rejects.toThrow(/probability/)
  })

  it('fails loud when the call fails, naming the case and keeping the cause', async () => {
    const cause = new Error('Decision request failed (401): bad key')
    const decide: Decide = async () => {
      throw cause
    }
    const error = await runChecks({ fixtures: fixtures(), decide }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/a1/)
    expect((error as Error).message).toMatch(/bad key/)
    expect((error as Error).cause).toBe(cause)
  })
})
