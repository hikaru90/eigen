import type { FixtureFile, FixtureKind } from './fixtures'
import { buildCaptureAuditRequest } from '$lib/server/capture-review/audit-questions'
import { buildCaptureReasonRequest } from '$lib/server/capture-review/reason-question'
import type { DecisionRequest, DecisionResponse } from '$lib/server/llm/decision-client'

/**
 * The pure core of `npm run jev:check`: builds each fixture case's request with the production
 * question builder, asks Jev through an injected `decide`, and compares the answers with the
 * planner's labels. No I/O of its own.
 */

/** An agreeing answer below this probability is reported as `low`: right, but not by much. */
export const LOW_PROBABILITY = 0.8

export type Decide = (request: DecisionRequest) => Promise<DecisionResponse>

export type CheckStatus = 'ok' | 'low' | 'mismatch'

export type CheckRow = {
  caseId: string
  questionId: string
  expected: string
  choice: string
  /** Jev's probability for the label it chose. */
  probability: number
  status: CheckStatus
}

export type PreparedCase = {
  kind: FixtureKind
  id: string
  note: string | null
  request: DecisionRequest
  expected: Record<string, string>
}

export type CaseResult = {
  kind: FixtureKind
  caseId: string
  note: string | null
  request: DecisionRequest
  rows: CheckRow[]
  /** Model that answered, as the provider reported it. */
  model: string
  /** Provider-reported cost of this case's call; null when the provider reported none. */
  reportedCostUsd: number | null
}

export type CheckTotals = { questions: number; ok: number; low: number; mismatch: number }

export type CheckResult = {
  cases: CaseResult[]
  rows: CheckRow[]
  totals: CheckTotals
  /** Distinct models that answered. */
  models: string[]
  /** Sum of the provider-reported costs; never inferred. */
  reportedCostUsd: number
  /** Calls whose response carried no cost (not counted in the sum). */
  callsWithoutReportedCost: number
}

export type CaseFilter = { kind: FixtureKind | null; caseIds: string[] }

function fail(message: string): never {
  throw new Error(`[jev-check] ${message}`)
}

type BuiltCase = Omit<PreparedCase, 'kind'>

/** Each case of a file with its request, built by the production builder for the file's kind. */
function buildCases(file: FixtureFile): BuiltCase[] {
  if (file.kind === 'capture_audit') {
    return file.cases.map((c) => ({
      id: c.id,
      note: c.note ?? null,
      expected: c.expected,
      request: buildCaptureAuditRequest(c.input),
    }))
  }
  return file.cases.map((c) => ({
    id: c.id,
    note: c.note ?? null,
    expected: c.expected,
    request: buildCaptureReasonRequest(c.input),
  }))
}

/**
 * Builds every case's request and checks the labels against it. Fails loud when a case's expected
 * keys are not exactly the question ids the builder produced, or a label is not one of that
 * question's criteria. Builder validation errors (an invalid fixture input) pass through.
 */
export function prepareCases(files: FixtureFile[]): PreparedCase[] {
  const seen = new Set<string>()
  const prepared: PreparedCase[] = []
  for (const file of files) {
    for (const c of buildCases(file)) {
      if (seen.has(c.id)) fail(`duplicate case id "${c.id}"`)
      seen.add(c.id)

      const asked = Object.keys(c.request.questions)
      const missing = asked.filter((id) => !Object.hasOwn(c.expected, id))
      const unexpected = Object.keys(c.expected).filter(
        (id) => !Object.hasOwn(c.request.questions, id),
      )
      if (missing.length > 0 || unexpected.length > 0) {
        fail(
          `case ${c.id}: expected must have exactly the questions the builder asks (${asked.join(', ')}); ` +
            `missing: ${missing.join(', ') || 'none'}; not asked: ${unexpected.join(', ') || 'none'}`,
        )
      }
      for (const [questionId, label] of Object.entries(c.expected)) {
        const labels = Object.keys(c.request.questions[questionId].criteria)
        if (!labels.includes(label)) {
          fail(
            `case ${c.id}: question ${questionId} expects "${label}", which is not one of: ${labels.join(', ')}`,
          )
        }
      }
      prepared.push({ kind: file.kind, ...c })
    }
  }
  return prepared
}

/** Keeps the cases of one kind and/or the named cases; unknown names and empty selections fail loud. */
export function filterFixtures(files: FixtureFile[], filter: CaseFilter): FixtureFile[] {
  const inKind = files.filter((f) => filter.kind === null || f.kind === filter.kind)
  const available = inKind.flatMap((f) => f.cases.map((c) => c.id))
  for (const id of filter.caseIds) {
    if (!available.includes(id)) fail(`unknown case "${id}" (available: ${available.join(', ')})`)
  }
  const wanted = (c: { id: string }) => filter.caseIds.length === 0 || filter.caseIds.includes(c.id)
  const selected: FixtureFile[] = []
  for (const file of inKind) {
    if (file.kind === 'capture_audit') {
      const cases = file.cases.filter(wanted)
      if (cases.length > 0) selected.push({ ...file, cases })
    } else {
      const cases = file.cases.filter(wanted)
      if (cases.length > 0) selected.push({ ...file, cases })
    }
  }
  if (selected.length === 0) fail('no cases selected')
  return selected
}

function rowsFor(prepared: PreparedCase, response: DecisionResponse): CheckRow[] {
  return Object.keys(prepared.request.questions).map((questionId) => {
    const answer = response.answers[questionId]
    if (!answer) fail(`case ${prepared.id}: question ${questionId} got no answer from Jev`)
    const labels = Object.keys(prepared.request.questions[questionId].criteria)
    if (!labels.includes(answer.choice)) {
      fail(
        `case ${prepared.id}: question ${questionId} got "${answer.choice}", which is not one of: ${labels.join(', ')}`,
      )
    }
    const probability = answer.probabilities[answer.choice]
    if (typeof probability !== 'number') {
      fail(
        `case ${prepared.id}: question ${questionId} has no probability for the chosen label "${answer.choice}"`,
      )
    }
    const expected = prepared.expected[questionId]
    const status: CheckStatus =
      answer.choice !== expected ? 'mismatch' : probability < LOW_PROBABILITY ? 'low' : 'ok'
    return { caseId: prepared.id, questionId, expected, choice: answer.choice, probability, status }
  })
}

/** One `decide` call per case, with all its questions in one request. Cases run in order. */
export async function runChecks(input: {
  fixtures: FixtureFile[]
  decide: Decide
  /** Called as soon as a case is done. */
  onCase?: (result: CaseResult) => void
}): Promise<CheckResult> {
  const prepared = prepareCases(input.fixtures)

  const cases: CaseResult[] = []
  let reportedCostUsd = 0
  let callsWithoutReportedCost = 0
  for (const p of prepared) {
    let response: DecisionResponse
    try {
      response = await input.decide(p.request)
    } catch (err) {
      throw new Error(
        `[jev-check] case ${p.id}: the decision call failed: ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err,
        },
      )
    }
    if (response.reportedCostUsd === null) callsWithoutReportedCost += 1
    else reportedCostUsd += response.reportedCostUsd

    const result: CaseResult = {
      kind: p.kind,
      caseId: p.id,
      note: p.note,
      request: p.request,
      rows: rowsFor(p, response),
      model: response.model,
      reportedCostUsd: response.reportedCostUsd,
    }
    cases.push(result)
    input.onCase?.(result)
  }

  const rows = cases.flatMap((c) => c.rows)
  const count = (status: CheckStatus) => rows.filter((r) => r.status === status).length
  return {
    cases,
    rows,
    totals: {
      questions: rows.length,
      ok: count('ok'),
      low: count('low'),
      mismatch: count('mismatch'),
    },
    models: [...new Set(cases.map((c) => c.model))],
    reportedCostUsd,
    callsWithoutReportedCost,
  }
}
