import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  historySchema,
  preparedRowSchema,
  type ChatHistory,
  type PreparedRow,
  type Split,
} from './types'

/** The file prepare.py writes for a split. */
export const preparedFilename = (split: Split) => `personamem.${split}.jsonl`

export type PersonaQueries = {
  personaId: number
  historyPath: string
  queries: PreparedRow[]
}

function formatIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join('.') || '(row)'}: ${i.message}`).join('; ')
}

/** Reads and validates `personamem.<split>.jsonl` (written by prepare.py --split <split>). */
export function loadPreparedRows(dataDir: string, split: Split): PreparedRow[] {
  const path = join(dataDir, preparedFilename(split))
  const prepare = `python3 -I evals/personamem/prepare.py --data-dir ${dataDir} --split ${split}`
  if (!existsSync(path)) {
    throw new Error(`[personamem] ${path} not found; run: ${prepare}`)
  }
  const rows: PreparedRow[] = []
  const seen = new Set<string>()
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim()
    if (!text) continue
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (err) {
      throw new Error(`[personamem] ${path} line ${i + 1} is not JSON`, { cause: err })
    }
    if (
      typeof json === 'object' &&
      json !== null &&
      !('evidenceTurns' in json && 'preference' in json)
    ) {
      throw new Error(
        `[personamem] ${path} line ${i + 1} lacks evidenceTurns/preference; re-run: ${prepare}`,
      )
    }
    const parsed = preparedRowSchema.safeParse(json)
    if (!parsed.success) {
      throw new Error(
        `[personamem] ${path} line ${i + 1} is invalid: ${formatIssues(parsed.error.issues)}`,
      )
    }
    if (seen.has(parsed.data.questionId)) {
      throw new Error(
        `[personamem] ${path} line ${i + 1}: duplicate questionId ${parsed.data.questionId}`,
      )
    }
    seen.add(parsed.data.questionId)
    rows.push(parsed.data)
  }
  if (rows.length === 0) throw new Error(`[personamem] ${path} has no rows`)
  return rows
}

/** Rows grouped per persona, ascending persona id; query order within a persona is file order. */
export function groupByPersona(rows: readonly PreparedRow[]): PersonaQueries[] {
  const byPersona = new Map<number, PersonaQueries>()
  for (const row of rows) {
    const group = byPersona.get(row.personaId)
    if (!group) {
      byPersona.set(row.personaId, {
        personaId: row.personaId,
        historyPath: row.historyPath,
        queries: [row],
      })
      continue
    }
    if (group.historyPath !== row.historyPath) {
      throw new Error(
        `[personamem] persona ${row.personaId} references two history files: ${group.historyPath}, ${row.historyPath}`,
      )
    }
    group.queries.push(row)
  }
  return [...byPersona.values()].sort((a, b) => a.personaId - b.personaId)
}

export function loadHistory(path: string): ChatHistory {
  if (!existsSync(path)) throw new Error(`[personamem] history file not found: ${path}`)
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`[personamem] history file is not JSON: ${path}`, { cause: err })
  }
  const parsed = historySchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(
      `[personamem] history file ${path} is invalid: ${formatIssues(parsed.error.issues)}`,
    )
  }
  return parsed.data
}
