import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDecisionShadowConfig, runDecisionModel } from '$lib/server/llm/decision-client'
import {
  LOW_PROBABILITY,
  filterFixtures,
  prepareCases,
  runChecks,
  type CaseResult,
  type CheckResult,
  type CheckRow,
  type Decide,
} from './check'
import { FIXTURE_KINDS, loadFixtureFiles, type FixtureKind } from './fixtures'

export const JEV_CHECK_USAGE = `Usage: npm run jev:check -- [options]

Runs labelled capture-review examples through the production question builders and asks Jev.
Prints where Jev disagrees with the expected label. Writes nothing to the database, the activity
log or the eval cache. Needs DECISION_SHADOW_ENABLED=true, OPENROUTER_API_KEY and
DECISION_SHADOW_MODEL (from .env or the environment) unless --dry-run.

Options:
  --kind capture_audit|capture_reason   Only that fixture kind (default: both)
  --case ID                             Only this case; repeat for several
  --dry-run                             Print each built request as JSON and make NO call
  --help                                This text

Exit code: 1 when any answer disagrees with its expected label, else 0. The full result is
written to evals/.data/jev-check/<timestamp>.json.`

export class JevCheckUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JevCheckUsageError'
  }
}

export type JevCheckArgs = {
  kind: FixtureKind | null
  caseIds: string[]
  dryRun: boolean
  help: boolean
}

export function parseJevCheckArgs(argv: string[]): JevCheckArgs {
  const args: JevCheckArgs = { kind: null, caseIds: [], dryRun: false, help: false }
  const valueOf = (flag: string, i: number): string => {
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--'))
      throw new JevCheckUsageError(`${flag} needs a value`)
    return value
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--kind') {
      const value = valueOf(arg, i++)
      if (args.kind !== null) throw new JevCheckUsageError('--kind given more than once')
      if (!(FIXTURE_KINDS as readonly string[]).includes(value)) {
        throw new JevCheckUsageError(
          `--kind must be capture_audit or capture_reason, got "${value}"`,
        )
      }
      args.kind = value as FixtureKind
    } else if (arg === '--case') {
      const value = valueOf(arg, i++)
      if (args.caseIds.includes(value))
        throw new JevCheckUsageError(`--case "${value}" given more than once`)
      args.caseIds.push(value)
    } else {
      throw new JevCheckUsageError(`unknown argument "${arg}"`)
    }
  }
  return args
}

/** The live Jev call. No defaults: a missing or disabled decision config is an error that names the variables. */
export function resolveLiveDecide(env: Record<string, string | undefined>): Decide {
  const config = resolveDecisionShadowConfig(env)
  if (!config) {
    throw new Error(
      '[jev-check] the decision model is not configured: set DECISION_SHADOW_ENABLED=true, OPENROUTER_API_KEY and DECISION_SHADOW_MODEL (in .env or the environment), or use --dry-run',
    )
  }
  return (request) => runDecisionModel(config, request)
}

export type JevCheckDeps = {
  env: Record<string, string | undefined>
  /** Replaces the live call (tests). */
  decide?: Decide
  log: (line: string) => void
  /** Where the result JSON goes. */
  outDir: string
  now: () => Date
}

export type JevCheckOutcome = { exitCode: 0 | 1; resultPath: string | null }

function table(rows: CheckRow[]): string[] {
  const header = {
    questionId: 'question',
    expected: 'expected',
    choice: 'jev',
    probability: 'prob',
    status: 'status',
  }
  const width = (pick: (r: typeof header) => string) =>
    Math.max(
      pick(header).length,
      ...rows.map((r) => pick({ ...r, probability: r.probability.toFixed(3) }).length),
    )
  const wQuestion = width((r) => r.questionId)
  const wExpected = width((r) => r.expected)
  const wChoice = width((r) => r.choice)
  const line = (q: string, e: string, c: string, p: string, s: string) =>
    `  ${q.padEnd(wQuestion)}  ${e.padEnd(wExpected)}  ${c.padEnd(wChoice)}  ${p.padStart(5)}  ${s}`
  return [
    line(header.questionId, header.expected, header.choice, header.probability, header.status),
    ...rows.map((r) =>
      line(r.questionId, r.expected, r.choice, r.probability.toFixed(3), r.status),
    ),
  ]
}

function printCase(c: CaseResult, log: (line: string) => void): void {
  log(`\n${c.caseId} (${c.kind})${c.note ? ` — ${c.note}` : ''}`)
  for (const row of table(c.rows)) log(row)
}

function printRecap(result: CheckResult, log: (line: string) => void): void {
  const list = (title: string, rows: CheckRow[]) => {
    if (rows.length === 0) return
    log(`\n${title} (${rows.length})`)
    for (const r of rows) {
      log(
        `  ${r.caseId}  ${r.questionId}: expected ${r.expected}, Jev ${r.choice} at ${r.probability.toFixed(3)}`,
      )
    }
  }
  list(
    'Mismatches',
    result.rows.filter((r) => r.status === 'mismatch'),
  )
  list(
    `Low (agrees, probability below ${LOW_PROBABILITY})`,
    result.rows.filter((r) => r.status === 'low'),
  )

  const { questions, ok, low, mismatch } = result.totals
  const unreported =
    result.callsWithoutReportedCost > 0
      ? `  (${result.callsWithoutReportedCost} call(s) reported no cost)`
      : ''
  log(
    `\nTOTAL  questions ${questions}  ok ${ok}  low ${low}  mismatch ${mismatch}  USD ${result.reportedCostUsd.toFixed(6)}${unreported}`,
  )
}

export async function runJevCheck(argv: string[], deps: JevCheckDeps): Promise<JevCheckOutcome> {
  const args = parseJevCheckArgs(argv)
  if (args.help) {
    deps.log(JEV_CHECK_USAGE)
    return { exitCode: 0, resultPath: null }
  }

  // The selection and the fixtures are checked before the config is looked at, so a typo costs nothing.
  const fixtures = filterFixtures(loadFixtureFiles(), { kind: args.kind, caseIds: args.caseIds })
  const prepared = prepareCases(fixtures)

  if (args.dryRun) {
    for (const p of prepared) {
      deps.log(`=== ${p.id} (${p.kind})${p.note ? ` — ${p.note}` : ''} ===`)
      deps.log(JSON.stringify(p.request, null, 2))
    }
    return { exitCode: 0, resultPath: null }
  }

  const decide = deps.decide ?? resolveLiveDecide(deps.env)
  const startedAt = deps.now()
  const result = await runChecks({ fixtures, decide, onCase: (c) => printCase(c, deps.log) })
  printRecap(result, deps.log)

  mkdirSync(deps.outDir, { recursive: true })
  const resultPath = join(deps.outDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        startedAt: startedAt.toISOString(),
        filters: { kind: args.kind, caseIds: args.caseIds },
        models: result.models,
        totals: result.totals,
        reportedCostUsd: result.reportedCostUsd,
        callsWithoutReportedCost: result.callsWithoutReportedCost,
        rows: result.rows,
        cases: result.cases,
      },
      null,
      2,
    ),
  )
  deps.log(`\nResult written to ${resultPath}`)

  return { exitCode: result.totals.mismatch > 0 ? 1 : 0, resultPath }
}
