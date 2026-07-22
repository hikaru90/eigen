export type VersionEvalTestResult = {
  qaId: string
  question: string
  tags: string[]
  active: boolean
  runId: string | null
  runStatus: string | null
  runLabel: string | null
  scoreLine: string | null
  scorePercent: number | null
}

export type VersionEvalOverview = {
  version: string
  tests: VersionEvalTestResult[]
}
