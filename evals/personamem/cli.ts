import { resolve } from 'node:path'
import { assertEvalChatModel } from '$lib/server/llm/eval-chat-model'

export const PERSONAMEM_USAGE = `Usage: npm run eval:personamem -- [options]

Required:
  --data-dir DIR            Contains personamem.benchmark.jsonl (from prepare.py) and data/chat_history_32k
  --chat-model MODEL        vendor/name; drives capture, enrich, composeAnswer and the chooser (e.g. openai/gpt-4o-mini)
  --tenant-concurrency N    Personas processed side by side
  --enrich-concurrency N    Enrich workers within one persona (1 = strictly incremental, D6)
  exactly one of:
    --personas N --seed S   Seeded sample of N personas
    --persona-ids a,b,c     Explicit persona ids
    --all                   Every persona

Optional:
  --run-id NAME             Run directory name (evals/reports/public/personamem-v2/NAME); required with --resume
  --resume                  Continue an existing run directory; answered questions are skipped
  --skip-ingest             Reuse existing tenants (fails if a tenant does not hold exactly the planned captures)
  --limit-queries N         At most N queries per persona
  --dry-run                 Print the plan and exit; touches no database and no LLM
`

export class PersonaMemUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersonaMemUsageError'
  }
}

export type PersonaSelection =
  { kind: 'sample'; count: number; seed: string } | { kind: 'ids'; ids: number[] } | { kind: 'all' }

export type PersonaMemCli = {
  dataDir: string
  chatModel: string
  tenantConcurrency: number
  enrichConcurrency: number
  selection: PersonaSelection
  runId: string | null
  resume: boolean
  skipIngest: boolean
  limitQueries: number | null
  dryRun: boolean
}

const VALUE_FLAGS = new Set([
  '--data-dir',
  '--chat-model',
  '--tenant-concurrency',
  '--enrich-concurrency',
  '--personas',
  '--seed',
  '--persona-ids',
  '--run-id',
  '--limit-queries',
])
const BOOLEAN_FLAGS = new Set(['--all', '--resume', '--skip-ingest', '--dry-run'])

function positiveInt(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw.trim()) || Number(raw) < 1) {
    throw new PersonaMemUsageError(
      `${flag} must be a positive integer, got: ${JSON.stringify(raw)}`,
    )
  }
  return Number(raw)
}

function requireValue(values: Map<string, string>, flag: string): string {
  const value = values.get(flag)
  if (value === undefined || !value.trim()) throw new PersonaMemUsageError(`${flag} is required`)
  return value
}

function parsePersonaIds(raw: string): number[] {
  const ids: number[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!/^\d+$/.test(trimmed)) {
      throw new PersonaMemUsageError(
        `--persona-ids must be comma-separated integers, got: ${JSON.stringify(raw)}`,
      )
    }
    const id = Number(trimmed)
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export function parsePersonaMemCli(argv: readonly string[]): PersonaMemCli {
  const values = new Map<string, string>()
  const flags = new Set<string>()

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (BOOLEAN_FLAGS.has(arg)) {
      flags.add(arg)
    } else if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new PersonaMemUsageError(`${arg} requires a value`)
      }
      values.set(arg, value)
      i++
    } else {
      throw new PersonaMemUsageError(`unknown argument: ${arg}`)
    }
  }

  const dataDir = resolve(requireValue(values, '--data-dir'))
  let chatModel: string
  try {
    chatModel = assertEvalChatModel(requireValue(values, '--chat-model'))
  } catch (err) {
    throw new PersonaMemUsageError(
      `--chat-model: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const tenantConcurrency = positiveInt(
    '--tenant-concurrency',
    requireValue(values, '--tenant-concurrency'),
  )
  const enrichConcurrency = positiveInt(
    '--enrich-concurrency',
    requireValue(values, '--enrich-concurrency'),
  )

  const chosen = [values.has('--personas'), values.has('--persona-ids'), flags.has('--all')].filter(
    Boolean,
  )
  if (chosen.length === 0) {
    throw new PersonaMemUsageError(
      'select personas with exactly one of --personas N --seed S, --persona-ids a,b, or --all',
    )
  }
  if (chosen.length > 1) {
    throw new PersonaMemUsageError(
      'select personas with exactly one of --personas, --persona-ids, or --all (got several)',
    )
  }

  let selection: PersonaSelection
  if (values.has('--personas')) {
    const seed = values.get('--seed')
    if (seed === undefined || !seed.trim())
      throw new PersonaMemUsageError('--personas requires --seed')
    selection = {
      kind: 'sample',
      count: positiveInt('--personas', values.get('--personas')!),
      seed,
    }
  } else {
    if (values.has('--seed')) throw new PersonaMemUsageError('--seed is only valid with --personas')
    selection = values.has('--persona-ids')
      ? { kind: 'ids', ids: parsePersonaIds(values.get('--persona-ids')!) }
      : { kind: 'all' }
  }

  const runId = values.get('--run-id') ?? null
  if (runId !== null && !runId.trim()) throw new PersonaMemUsageError('--run-id must not be blank')
  const resume = flags.has('--resume')
  if (resume && runId === null) {
    throw new PersonaMemUsageError('--resume requires --run-id of the run to continue')
  }

  return {
    dataDir,
    chatModel,
    tenantConcurrency,
    enrichConcurrency,
    selection,
    runId,
    resume,
    skipIngest: flags.has('--skip-ingest'),
    limitQueries: values.has('--limit-queries')
      ? positiveInt('--limit-queries', values.get('--limit-queries')!)
      : null,
    dryRun: flags.has('--dry-run'),
  }
}
