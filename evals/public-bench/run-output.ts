import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  truncateSync,
  writeSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const PUBLIC_REPORTS_ROOT = resolve(import.meta.dirname, '../reports/public')

/** Eval-only LLM response cache (git-ignored with evals/.data/); shared by every run and every bench. */
export const EVAL_LLM_CACHE_DIR = resolve(import.meta.dirname, '../.data/llm-cache')

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

function fsyncDirectory(dir: string): void {
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/**
 * Appends one record and fsyncs it before returning: a record that was appended survives a
 * kill (SIGKILL, power loss), and the file never holds anything but whole lines plus at most
 * one torn last line (see `readJsonl`).
 */
export function appendJsonl(path: string, row: unknown): void {
  appendJsonlRows(path, [row])
}

/** Several records in ONE write + fsync (rows that belong together, e.g. a question's two variants). */
export function appendJsonlRows(path: string, rows: readonly unknown[]): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const created = !existsSync(path)
  const fd = openSync(path, 'a')
  try {
    writeSync(fd, rows.map((row) => `${JSON.stringify(row)}\n`).join(''))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (created) fsyncDirectory(dir)
}

let atomicCounter = 0

/** Whole-file write that is either the old content or the new one after a kill: temp, fsync, rename. */
export function writeFileAtomic(path: string, content: string): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const temp = `${path}.tmp-${process.pid}-${atomicCounter++}`
  const fd = openSync(temp, 'w')
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temp, path)
  fsyncDirectory(dir)
}

type JsonlEntry = { line: number; row: Record<string, unknown> }

/**
 * A kill during an append can leave the file's LAST line incomplete (no trailing newline). That
 * line is moved to `<file>.torn-<timestamp>` (with a warning) and the file is cut back to the
 * last whole line, so the run continues from the last complete record. A last line that is
 * complete JSON but lost only its newline gets the newline back. Anything else wrong - a bad
 * line anywhere else, or a bad last line that does end in a newline - is not a torn write and
 * fails loud in `readJsonlEntries`.
 */
function recoverTornLastLine(path: string): void {
  if (!existsSync(path)) return
  const content = readFileSync(path, 'utf8')
  if (content.length === 0 || content.endsWith('\n')) return
  const lastBreak = content.lastIndexOf('\n')
  const lastLine = content.slice(lastBreak + 1)
  try {
    JSON.parse(lastLine)
  } catch {
    const tornPath = `${path}.torn-${new Date().toISOString().replace(/[:.]/g, '-')}`
    writeFileAtomic(tornPath, lastLine)
    truncateSync(path, Buffer.byteLength(content.slice(0, lastBreak + 1)))
    console.warn(
      `[public-bench] ${path} ended in a torn last line (${Buffer.byteLength(lastLine)} bytes, a kill during an append); moved it to ${tornPath} and continued from the last complete record`,
    )
    return
  }
  const fd = openSync(path, 'a')
  try {
    writeSync(fd, '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function readJsonlEntries(path: string): JsonlEntry[] {
  if (!existsSync(path)) return []
  recoverTornLastLine(path)
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

/** Rewrites a JSONL file without the rows `drop` matches; a missing file stays missing. */
export function removeJsonlRows(
  path: string,
  drop: (row: Record<string, unknown>) => boolean,
): void {
  if (!existsSync(path)) return
  const kept = readJsonl(path).filter((row) => !drop(row))
  writeFileAtomic(path, kept.map((row) => `${JSON.stringify(row)}\n`).join(''))
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
  writeFileAtomic(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileAtomic(join(runDir, 'summary.md'), markdown)
}
