import { execFileSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Preflight building blocks for runs that spend real money: everything is checked BEFORE the
 * first paid call and every missing prerequisite is reported at once (not one per attempt).
 * The pieces are pure or take their I/O as arguments; the bench composes them with the live
 * database and gateway.
 */

export class PreflightError extends Error {
  constructor(readonly problems: string[]) {
    super(`[eval] preflight failed - the run was not started:\n- ${problems.join('\n- ')}`)
    this.name = 'PreflightError'
  }
}

export function throwIfProblems(problems: readonly string[]): void {
  if (problems.length > 0) throw new PreflightError([...problems])
}

/** The run directory can be created and written (a run that cannot record must not start). */
export function runDirProblems(dir: string): string[] {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.preflight-${process.pid}`)
    writeFileSync(probe, 'ok')
    unlinkSync(probe)
    return []
  } catch (err) {
    return [`run directory ${dir} is not writable: ${err instanceof Error ? err.message : err}`]
  }
}

export function missingFilesProblems(
  label: string,
  paths: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  return paths.filter((p) => !exists(p)).map((p) => `${label}: ${p} is missing`)
}

export type OpenRouterKeyInfo = {
  /** The key's credit limit in USD; null = unlimited. */
  limit: number | null
  /** Credit left on the key in USD; null = unlimited. */
  limitRemaining: number | null
  usage: number
}

const numberOrNull = (value: unknown, field: string): number | null => {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`[eval] OpenRouter /key response field "${field}" is not a number or null`)
}

/** `GET /api/v1/key` body: `{ data: { limit, limit_remaining, usage, ... } }`. */
export function parseOpenRouterKeyInfo(body: unknown): OpenRouterKeyInfo {
  const data = (body as { data?: unknown } | null)?.data
  if (data === null || typeof data !== 'object') {
    throw new Error('[eval] OpenRouter /key response has no data object')
  }
  const row = data as Record<string, unknown>
  if (typeof row.usage !== 'number' || !Number.isFinite(row.usage)) {
    throw new Error('[eval] OpenRouter /key response field "usage" is not a number')
  }
  return {
    limit: numberOrNull(row.limit, 'limit'),
    limitRemaining: numberOrNull(row.limit_remaining, 'limit_remaining'),
    usage: row.usage,
  }
}

/**
 * OpenRouter's documented key endpoint (`GET /api/v1/key`, any API key): the credit left on the
 * service key the run pays with. The error names the status only, never the key.
 */
export async function fetchOpenRouterKeyInfo(input: {
  baseUrl: string
  apiKey: string
  fetchFn: typeof fetch
}): Promise<OpenRouterKeyInfo> {
  const url = `${input.baseUrl.replace(/\/+$/, '')}/key`
  const res = await input.fetchFn(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.apiKey}` },
  })
  if (!res.ok) throw new Error(`[eval] OpenRouter GET ${url} failed with HTTP ${res.status}`)
  return parseOpenRouterKeyInfo(await res.json())
}

const usd = (x: number) => `$${x.toFixed(2)}`

export function openRouterCreditProblem(info: OpenRouterKeyInfo, required: number): string | null {
  if (info.limitRemaining === null) {
    return (
      'OpenRouter key has no credit limit, so the credit left cannot be checked against this run (' +
      `needs about ${usd(required)}): set a limit on the service key in the OpenRouter dashboard - it is also the hard stop against overspend`
    )
  }
  if (info.limitRemaining < required) {
    return `OpenRouter key has ${usd(info.limitRemaining)} left, the run needs about ${usd(required)} (estimate plus margin)`
  }
  return null
}

/** The run's estimate plus a safety margin. */
export const requiredUsd = (estimateUsd: number, margin: number): number => estimateUsd * margin

export function walletProblem(input: {
  availableCredits: number
  requiredCredits: number
}): string | null {
  if (input.availableCredits >= input.requiredCredits) return null
  return `harness wallet has ${input.availableCredits.toLocaleString('en-US')} credits, the run needs about ${Math.ceil(input.requiredCredits).toLocaleString('en-US')} (estimate plus margin)`
}

/** Journal migrations whose SQL hash the database has not recorded (the migrate script's own rule). */
export function pendingMigrationTags(input: {
  journalTags: readonly string[]
  readSql: (tag: string) => string
  hashOf: (sql: string) => string
  appliedHashes: ReadonlySet<string>
}): string[] {
  return input.journalTags.filter(
    (tag) => !input.appliedHashes.has(input.hashOf(input.readSql(tag))),
  )
}

/** Whether a process ancestor is `caffeinate` (macOS sleep prevention). Off macOS nothing is needed. */
export function isUnderCaffeinate(input: {
  platform: string
  pid: number
  parentOf: (pid: number) => { ppid: number; command: string } | null
}): boolean {
  if (input.platform !== 'darwin') return true
  let pid = input.pid
  for (let depth = 0; depth < 10; depth++) {
    const parent = input.parentOf(pid)
    if (parent === null || parent.ppid <= 1) return false
    if (/(^|\/)caffeinate$/.test(parent.command.trim())) return true
    pid = parent.ppid
  }
  return false
}

/** Real `parentOf`: one `ps` call per level. */
export function psParentOf(pid: number): { ppid: number; command: string } | null {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim()
    const match = /^(\d+)\s+(.+)$/.exec(out)
    if (!match) return null
    const ppid = Number(match[1])
    const command = execFileSync('ps', ['-o', 'comm=', '-p', String(ppid)], {
      encoding: 'utf8',
    }).trim()
    return { ppid, command }
  } catch {
    return null
  }
}

export const caffeinateAdvice = (command: string): string => `caffeinate -i ${command}`
