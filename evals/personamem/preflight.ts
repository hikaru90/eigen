import type { Split } from './types'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  missingFilesProblems,
  openRouterCreditProblem,
  requiredUsd,
  runDirProblems,
  walletProblem,
  type OpenRouterKeyInfo,
} from '../harness/preflight'
import { preparedFilename } from './load-dataset'

/**
 * PersonaMem preflight: everything that can be checked before the first paid call, reported
 * together. The estimate is rough (and excludes the Ask agent loop), so credit is checked
 * against estimate x PREFLIGHT_MARGIN.
 */
export const PREFLIGHT_MARGIN = 1.5

/** Needs no database and no network. */
export function staticPreflightProblems(input: {
  dataDir: string
  split: Split
  runDir: string
  env: Readonly<Record<string, string | undefined>>
}): string[] {
  return [
    ...missingFilesProblems(
      'PersonaMem data',
      [join(input.dataDir, preparedFilename(input.split))],
      existsSync,
    ),
    ...(input.env.DATABASE_URL?.trim() ? [] : ['DATABASE_URL is required and missing']),
    ...runDirProblems(input.runDir),
  ]
}

/** The live reads, injected: the real ones are in `liveChecks` (run-live.ts wires them). */
export type LiveChecks = {
  /** Problems with the database: not reachable, migrations not applied. */
  checkDatabase(): Promise<string[]>
  fetchKeyInfo(): Promise<OpenRouterKeyInfo>
  /** Credits available in the harness operator's wallet. */
  walletCredits(): Promise<number>
}

export async function livePreflightProblems(input: {
  estimateUsd: number
  checks: LiveChecks
  /** Wallet credits a USD amount of gateway cost debits (markup included), from the pricing module. */
  creditsFor: (usd: number) => number
}): Promise<string[]> {
  const { checks } = input
  const required = requiredUsd(input.estimateUsd, PREFLIGHT_MARGIN)
  const problems: string[] = []

  const database = await checks.checkDatabase()
  problems.push(...database)

  try {
    const problem = openRouterCreditProblem(await checks.fetchKeyInfo(), required)
    if (problem !== null) problems.push(problem)
  } catch (err) {
    problems.push(
      `OpenRouter credit could not be checked: ${err instanceof Error ? err.message : err}`,
    )
  }

  if (database.length === 0) {
    const problem = walletProblem({
      availableCredits: await checks.walletCredits(),
      requiredCredits: input.creditsFor(required),
    })
    if (problem !== null) problems.push(problem)
  }
  return problems
}
