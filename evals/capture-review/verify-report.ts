import { CAPTURE_REVIEW_THRESHOLD, SCORED_PARTS } from '$lib/server/capture-review/review-parts'
import { renderTable } from './report'
import {
  weakestScoredPart,
  type CaseOutcome,
  type CaseTarget,
  type Check,
  type ReviewSnapshot,
} from './verify-judge'

/**
 * What `npm run capture-review:verify` prints: one table row per case, the findings behind every
 * FAIL, the vote checks, the operator deltas and the total cost. Pure formatting of results the live
 * runner has already read. The cases are made-up fixtures; no real capture is ever printed, and
 * neither is an injected value.
 */

export type VerifyCaseRow = {
  id: string
  kind: 'clean' | 'mistake'
  /** The mutation's short label; null for a clean case. */
  mutation: string | null
  target: CaseTarget | null
  before: ReviewSnapshot | null
  after: ReviewSnapshot | null
  outcome: CaseOutcome
  /** Plain facts about the injection (the made-up fixture's strings), printed under Findings. */
  notes?: string[]
}

export type VoteCheckGroup = {
  title: string
  checks: Check[]
  /** Facts reported without an assertion. */
  notes: string[]
}

export type VerifyReportInput = {
  cases: VerifyCaseRow[]
  voteGroups: VoteCheckGroup[]
  deltas: Check[]
  /** Total USD of the tenant's activity log, or null when it could not be read. */
  totalUsd: string | null
  notes: string[]
}

const fixed = (n: number): string => n.toFixed(4)

function scoreOf(review: ReviewSnapshot | null): string {
  if (review === null) return '-'
  return review.score === null ? review.status : fixed(review.score)
}

function beforeCell(review: ReviewSnapshot | null): string {
  if (review === null) return '-'
  const weakest = weakestScoredPart(review.parts)
  return weakest === null ? scoreOf(review) : `${scoreOf(review)} ${weakest.ref}`
}

function targetCell(row: VerifyCaseRow): string {
  const { targetLabel, targetProbability } = row.outcome
  if (row.target === null) return '-'
  if (targetLabel === null || targetProbability === null)
    return `${row.target.ref ?? row.target.part} (missing)`
  return `${row.target.ref ?? row.target.part} ${targetLabel} ${fixed(targetProbability)}`
}

/** The scored parts under the threshold, weakest first, as `ref label probability`. */
function weakPartsLine(review: ReviewSnapshot | null): string {
  if (review === null) return ''
  return review.parts
    .filter((p) => SCORED_PARTS.includes(p.part as (typeof SCORED_PARTS)[number]))
    .filter((p) => p.probability < CAPTURE_REVIEW_THRESHOLD)
    .sort((a, b) => a.probability - b.probability)
    .map((p) => `${p.ref} ${p.label} ${fixed(p.probability)}`)
    .join(', ')
}

function failedChecks(checks: Check[]): Check[] {
  return checks.filter((c) => !c.ok)
}

function checkLines(checks: Check[]): string[] {
  return renderTable(
    ['CHECK', 'EXPECTED', 'ACTUAL', 'RESULT'],
    checks.map((c) => [c.name, c.expected, c.actual, c.ok ? 'PASS' : 'FAIL']),
    '  ',
  )
}

export function verifyExitCode(input: VerifyReportInput): 0 | 1 {
  if (input.cases.length === 0) return 1
  const casesOk = input.cases.every((c) => c.outcome.pass)
  const votesOk = input.voteGroups.every((g) => failedChecks(g.checks).length === 0)
  return casesOk && votesOk && failedChecks(input.deltas).length === 0 ? 0 : 1
}

export function formatVerifyReport(input: VerifyReportInput): string {
  const lines: string[] = ['', '=== Cases']
  lines.push(
    ...renderTable(
      ['CASE', 'MUTATION', 'BEFORE', 'AFTER', 'TARGET', 'OTHER', 'RESULT'],
      input.cases.map((c) => [
        c.id,
        c.mutation ?? '-',
        beforeCell(c.before),
        c.kind === 'clean' ? '-' : scoreOf(c.after),
        targetCell(c),
        c.outcome.otherChanges.length > 0 ? c.outcome.otherChanges.join(', ') : '-',
        c.outcome.pass ? 'PASS' : 'FAIL',
      ]),
      '',
    ),
  )

  const findings: string[] = []
  for (const c of input.cases) {
    for (const note of c.notes ?? []) findings.push(`${c.id}: note: ${note}`)
    for (const reason of c.outcome.reasons) findings.push(`${c.id}: ${reason}`)
    if (!c.outcome.pass || c.outcome.beforeWeak) {
      const before = weakPartsLine(c.before)
      if (before) findings.push(`${c.id}: parts below the threshold before: ${before}`)
      const after = weakPartsLine(c.after)
      if (after) findings.push(`${c.id}: parts below the threshold after: ${after}`)
    }
    if (c.outcome.beforeWeak) {
      const weakest = c.before === null ? null : weakestScoredPart(c.before.parts)
      findings.push(
        `${c.id}: already below the threshold before the injection (weakest ${
          weakest === null ? 'none' : `${weakest.ref} ${fixed(weakest.probability)}`
        })`,
      )
    }
  }
  if (findings.length > 0) lines.push('', '=== Findings', ...findings.map((f) => `  ${f}`))

  lines.push('', '=== Votes')
  for (const group of input.voteGroups) {
    lines.push(
      '',
      group.title,
      ...checkLines(group.checks),
      ...group.notes.map((n) => `  note: ${n}`),
    )
  }

  lines.push('', '=== Operator counts (loadCaptureQuality, includeHarness, after minus before)')
  lines.push(...checkLines(input.deltas))

  const casesFailed = input.cases.filter((c) => !c.outcome.pass).length
  const checksFailed =
    input.voteGroups.reduce((n, g) => n + failedChecks(g.checks).length, 0) +
    failedChecks(input.deltas).length
  lines.push('', '=== Totals')
  if (input.notes.length > 0) lines.push(...input.notes.map((n) => `note:    ${n}`))
  lines.push(
    `cases:   ${input.cases.length - casesFailed} of ${input.cases.length} PASS`,
    `checks:  ${checksFailed} failed (votes and operator counts)`,
    `USD:     ${input.totalUsd ?? '-'}`,
    verifyExitCode(input) === 0
      ? 'result:  OK'
      : `result:  FAIL · ${casesFailed} case(s), ${checksFailed} check(s)`,
    '',
  )
  return lines.join('\n')
}
