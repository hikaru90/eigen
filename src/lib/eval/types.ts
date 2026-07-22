/** Shared eval types for harness + SvelteKit routes. */

export type EvalSynthesis = {
  goalExplanation: string
  measurementSummary: string
  currentStrategy: string
  findings: Array<{
    severity: 'critical' | 'high' | 'normal'
    title: string
    evidence: string
  }>
  optimizationPaths: Array<{
    priority: number
    action: string
    rationale: string
    expectedImpact: string
  }>
  narrative: string
}

export type EvalRunListItem = {
  id: string
  label: string
  scenarioId: string | null
  status: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  entryCount: number
  passedCount: number
  failedCount: number
}

export type EvalRunSummary = {
  id: string
  label: string
  scenarioId: string | null
  status: string
  evalUserId: string
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  synthesis: EvalSynthesis | null
  entryCount: number
  passedCount: number
  failedCount: number
}

export type EvalEntrySummary = {
  id: string
  ordinal: number
  kind: string
  fixtureRef: string | null
  status: string
  passed: boolean | null
  durationMs: number | null
  error: string | null
  input: Record<string, unknown>
  expected: Record<string, unknown>
  result: Record<string, unknown> | null
}
