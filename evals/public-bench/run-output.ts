import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const PUBLIC_REPORTS_ROOT = resolve(import.meta.dirname, '../reports/public')

export type SummaryTable = {
  columns: string[]
  rows: (string | number)[][]
}

export type SummarySection = {
  heading: string
  lines?: string[]
  table?: SummaryTable
}

export type RunSummary = {
  bench: string
  runId: string
  title: string
  startedAt: string
  finishedAt: string
  config: Record<string, unknown>
  metrics: Record<string, unknown>
  sections: SummarySection[]
}

function assertPathSegment(label: string, value: string): void {
  if (
    !value.trim() ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    throw new Error(
      `[public-bench] ${label} must be a single non-empty path segment, got: ${JSON.stringify(value)}`,
    )
  }
}

/** `evals/reports/public/<bench>/<runId>/` (reports root overridable for tests). */
export function resolveRunDir(input: {
  bench: string
  runId: string
  reportsRoot?: string
}): string {
  assertPathSegment('bench', input.bench)
  assertPathSegment('runId', input.runId)
  return join(input.reportsRoot ?? PUBLIC_REPORTS_ROOT, input.bench, input.runId)
}

export function appendJsonl(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(row)}\n`)
}

type JsonlEntry = { line: number; row: Record<string, unknown> }

function readJsonlEntries(path: string): JsonlEntry[] {
  if (!existsSync(path)) return []
  const entries: JsonlEntry[] = []
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim()
    if (!text) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      throw new Error(
        `[public-bench] corrupt JSONL in ${path} at line ${i + 1}: ${err instanceof Error ? err.message : err}`,
        { cause: err },
      )
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`[public-bench] ${path} line ${i + 1} is not a JSON object`)
    }
    entries.push({ line: i + 1, row: parsed as Record<string, unknown> })
  }
  return entries
}

/** Every row of a JSONL file; a missing file is an empty run, a corrupt line throws. */
export function readJsonl(path: string): Record<string, unknown>[] {
  return readJsonlEntries(path).map((entry) => entry.row)
}

/** Ids already written to a JSONL file (for `--resume`). */
export function readJsonlIds(path: string, idField: string): Set<string> {
  const ids = new Set<string>()
  for (const { line, row } of readJsonlEntries(path)) {
    const id = row[idField]
    if (typeof id !== 'string' || !id) {
      throw new Error(
        `[public-bench] ${path} line ${line} has no non-empty string field "${idField}"`,
      )
    }
    ids.add(id)
  }
  return ids
}

function formatCell(value: string | number): string {
  return String(value).replace(/\|/g, '\\|')
}

function renderTable(table: SummaryTable, heading: string): string[] {
  for (const row of table.rows) {
    if (row.length !== table.columns.length) {
      throw new Error(
        `[public-bench] table "${heading}": row has ${row.length} cell(s), expected ${table.columns.length}`,
      )
    }
  }
  return [
    `| ${table.columns.map(formatCell).join(' | ')} |`,
    `| ${table.columns.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${row.map(formatCell).join(' | ')} |`),
  ]
}

function renderMarkdown(summary: RunSummary): string {
  const out: string[] = [
    `# ${summary.title}`,
    '',
    `- bench: ${summary.bench}`,
    `- run: ${summary.runId}`,
    `- started: ${summary.startedAt}`,
    `- finished: ${summary.finishedAt}`,
    '',
    '## Config',
    '',
    ...Object.entries(summary.config).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`),
    '',
    '## Metrics',
    '',
    ...Object.entries(summary.metrics).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`),
  ]
  for (const section of summary.sections) {
    out.push('', `## ${section.heading}`, '')
    if (section.lines) out.push(...section.lines.map((line) => `- ${line}`))
    if (section.lines && section.table) out.push('')
    if (section.table) out.push(...renderTable(section.table, section.heading))
  }
  return `${out.join('\n')}\n`
}

/** Writes `summary.json` and `summary.md` into `runDir`. */
export function writeSummary(runDir: string, summary: RunSummary): void {
  const markdown = renderMarkdown(summary)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(runDir, 'summary.md'), markdown)
}
