import { resolve } from 'node:path'
import { assertEvalChatModel } from '$lib/server/llm/eval-chat-model'
import {
  ANSWER_MODES,
  SPLITS,
  type AnswerMode,
  type RelevanceFloorSetting,
  type Split,
} from './types'

export const PERSONAMEM_USAGE = `Usage: npm run eval:personamem -- [options]

Required:
  --data-dir DIR            Contains personamem.<split>.jsonl (from prepare.py) and, for full-history runs, data/chat_history_32k
  --split benchmark|val     Which PersonaMem-v2 split (no default). Tune on val, report on benchmark; val histories are
                            not downloaded, so full-history runs on val need them fetched first
  --chat-model MODEL        vendor/name; drives capture enrich, Ask / composeAnswer and the chooser (e.g. openai/gpt-4o-mini)
  --answer ask|compose      How each question reaches Eigen (no default):
                              ask     the real Ask agent in a new session, bare query only; the chooser gets the full
                                      context of every answer_question call Ask made
                              compose composeAnswer directly on the bare query
  --tenant-concurrency N    Personas processed side by side
  --enrich-concurrency N    Enrich workers within one persona (1 = strictly incremental, D6)
  --relevance-floor product|X
                            Q&A relevance floor for thoughts and note passages: product = the constant real users
                            get (0.22), or an eval-only override X in [0, 1], e.g. 0.15 (harness tenants only)
  exactly one of:
    --personas N --seed S   Seeded sample of N personas
    --persona-ids a,b,c     Explicit persona ids
    --all                   Every persona
    --question-ids a,b      Exact questionIds (only with --evidence-only)
    --dev-set PATH          The questionIds listed in a dev-set file (evals/personamem/dev-set.val.json; only with
                            --evidence-only; its split must be --split)

  --run-id NAME             Run directory name (evals/reports/public/personamem-v2/NAME). Required for every real run
                            (not for --dry-run), so a resume is always one known command

Optional:
  --resume                  Continue an existing run directory (same flags required). Nothing recorded is re-done or deleted:
                            enriched captures are verified and skipped, queued-but-not-enriched ones are re-enriched, stored
                            answer stages are reused. Failed and unfinished items are retried. A run created with --fresh
                            (recorded in its run.json) also resets, on resume, each tenant that has no recorded capture yet,
                            exactly as --fresh would have at the first start; a tenant with any recorded capture is never
                            reset, and a run created without --fresh never resets a tenant
  --fresh                   Reset each tenant before its first capture, and remember that in run.json so a --resume resets the
                            tenants the first process never reached. Without it a tenant that already holds thoughts is
                            refused (it would be doubled). Not with --resume (a resume takes it from the run) or --reuse-ingest
  --max-history-turns N     REHEARSAL, not a score: ingest only each persona's first N user turns (questions whose evidence
                            is cut off are asked but count as without history evidence). Not with --evidence-only
  --reuse-ingest RUNID      Answer against the tenants an earlier run ingested (no ingest). Verified against that run's
                            ingest.jsonl and run.json (tenant ids, capture counts and digest, thought ids, thought
                            count); any mismatch fails. Answer again at another --relevance-floor without re-ingesting
  --limit-queries N         At most N queries per persona
  --evidence-only           SMOKE, not a benchmark score: per question, ingest ONLY that question's evidence user turns
                            (Capture) into its own tenant, then answer it. Prepare data with a current prepare.py
  --dry-run                 Print the plan and exit; touches no database and no LLM

Environment (eval-only):
  EVAL_CRASH_AT=<phase>:<n> Kill rehearsal: the process SIGKILLs itself after the n-th completed paid call of the phase
                            (ingest or answer). See evals/personamem/REHEARSAL.md
`

export class PersonaMemUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersonaMemUsageError'
  }
}

export type PersonaSelection =
  | { kind: 'sample'; count: number; seed: string }
  | { kind: 'ids'; ids: number[] }
  | { kind: 'questions'; ids: string[] }
  | { kind: 'devSet'; path: string }
  | { kind: 'all' }

export type PersonaMemCli = {
  dataDir: string
  split: Split
  chatModel: string
  tenantConcurrency: number
  enrichConcurrency: number
  answer: AnswerMode
  evidenceOnly: boolean
  selection: PersonaSelection
  runId: string | null
  resume: boolean
  /** Reset each tenant before its first capture (otherwise a tenant holding thoughts is refused). */
  fresh: boolean
  /** REHEARSAL: ingest only the first N user turns of each persona's history; null = the whole history. */
  maxHistoryTurns: number | null
  relevanceFloor: RelevanceFloorSetting
  /** Run id whose ingest this run answers against (no ingest in this run); null = ingest here. */
  reuseIngest: string | null
  limitQueries: number | null
  dryRun: boolean
}

const VALUE_FLAGS = new Set([
  '--data-dir',
  '--split',
  '--dev-set',
  '--chat-model',
  '--tenant-concurrency',
  '--enrich-concurrency',
  '--answer',
  '--question-ids',
  '--personas',
  '--seed',
  '--persona-ids',
  '--run-id',
  '--limit-queries',
  '--relevance-floor',
  '--reuse-ingest',
  '--max-history-turns',
])
const BOOLEAN_FLAGS = new Set(['--all', '--resume', '--dry-run', '--evidence-only', '--fresh'])

function isPathSegment(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\')
  )
}

function positiveInt(flag: string, raw: string): number {
  if (!/^\d+$/.test(raw.trim()) || Number(raw) < 1) {
    throw new PersonaMemUsageError(
      `${flag} must be a positive integer, got: ${JSON.stringify(raw)}`,
    )
  }
  return Number(raw)
}

const RELEVANCE_FLOOR_NUMBER = /^\d+(\.\d+)?$/

function parseRelevanceFloor(raw: string): RelevanceFloorSetting {
  const text = raw.trim()
  if (text === 'product') return 'product'
  const value = RELEVANCE_FLOOR_NUMBER.test(text) ? Number(text) : Number.NaN
  if (!(value >= 0 && value <= 1)) {
    throw new PersonaMemUsageError(
      `--relevance-floor must be product or a number from 0 to 1, got: ${JSON.stringify(raw)}`,
    )
  }
  return value
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

function parseQuestionIds(raw: string): string[] {
  const ids: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!/^p\d+-[0-9a-f]{12}$/.test(trimmed)) {
      throw new PersonaMemUsageError(
        `--question-ids must be comma-separated questionIds (p<persona>-<12 hex>), got: ${JSON.stringify(raw)}`,
      )
    }
    if (!ids.includes(trimmed)) ids.push(trimmed)
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
  const splitRaw = requireValue(values, '--split')
  const split = SPLITS.find((s) => s === splitRaw)
  if (split === undefined) {
    throw new PersonaMemUsageError(
      `--split must be one of ${SPLITS.join(', ')}, got: ${JSON.stringify(splitRaw)}`,
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

  const relevanceFloor = parseRelevanceFloor(requireValue(values, '--relevance-floor'))

  const answerRaw = requireValue(values, '--answer')
  const answer = ANSWER_MODES.find((mode) => mode === answerRaw)
  if (answer === undefined) {
    throw new PersonaMemUsageError(
      `--answer must be one of ${ANSWER_MODES.join(', ')}, got: ${JSON.stringify(answerRaw)}`,
    )
  }
  const evidenceOnly = flags.has('--evidence-only')
  if (values.has('--question-ids') && !evidenceOnly) {
    throw new PersonaMemUsageError(
      '--question-ids is only valid with --evidence-only (a full-history replay cannot be cut down to single questions)',
    )
  }

  if (values.has('--dev-set') && !evidenceOnly) {
    throw new PersonaMemUsageError(
      '--dev-set is only valid with --evidence-only (the dev set is a list of single questions, run as per-question tenants)',
    )
  }

  const chosen = [
    values.has('--personas'),
    values.has('--persona-ids'),
    values.has('--question-ids'),
    values.has('--dev-set'),
    flags.has('--all'),
  ].filter(Boolean)
  if (chosen.length === 0) {
    throw new PersonaMemUsageError(
      'select with exactly one of --personas N --seed S, --persona-ids a,b, --all, --question-ids a,b (with --evidence-only), or --dev-set PATH (with --evidence-only)',
    )
  }
  if (chosen.length > 1) {
    throw new PersonaMemUsageError(
      'select with exactly one of --personas, --persona-ids, --all, --question-ids, or --dev-set (got several)',
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
      : values.has('--question-ids')
        ? { kind: 'questions', ids: parseQuestionIds(values.get('--question-ids')!) }
        : values.has('--dev-set')
          ? { kind: 'devSet', path: resolve(requireValue(values, '--dev-set')) }
          : { kind: 'all' }
  }

  const runId = values.get('--run-id') ?? null
  if (runId !== null && !runId.trim()) throw new PersonaMemUsageError('--run-id must not be blank')
  const reuseIngest = values.get('--reuse-ingest') ?? null
  if (reuseIngest !== null) {
    if (!isPathSegment(reuseIngest)) {
      throw new PersonaMemUsageError(
        `--reuse-ingest must be the run id of an earlier run (a single path segment), got: ${JSON.stringify(reuseIngest)}`,
      )
    }
    if (reuseIngest === runId) {
      throw new PersonaMemUsageError(
        '--reuse-ingest must name an earlier run, not the run being created (--run-id)',
      )
    }
  }
  const resume = flags.has('--resume')
  const dryRun = flags.has('--dry-run')
  if (resume && runId === null) {
    throw new PersonaMemUsageError('--resume requires --run-id of the run to continue')
  }
  if (!dryRun && runId === null) {
    throw new PersonaMemUsageError(
      '--run-id is required for a real run (so --resume is always one known command)',
    )
  }
  const fresh = flags.has('--fresh')
  if (fresh && resume) {
    throw new PersonaMemUsageError(
      '--fresh cannot be combined with --resume (whether a run is fresh is fixed when it is created and recorded in its run.json; a resume takes it from there)',
    )
  }
  if (fresh && reuseIngest !== null) {
    throw new PersonaMemUsageError('--fresh cannot be combined with --reuse-ingest (nothing is ingested)')
  }
  if (values.has('--max-history-turns') && evidenceOnly) {
    throw new PersonaMemUsageError(
      '--max-history-turns cannot be combined with --evidence-only (an evidence-only run has no history to cap)',
    )
  }

  if (values.has('--question-ids') && values.has('--limit-queries')) {
    throw new PersonaMemUsageError('--limit-queries is not valid with --question-ids')
  }
  if (values.has('--dev-set') && values.has('--limit-queries')) {
    throw new PersonaMemUsageError('--limit-queries is not valid with --dev-set')
  }

  return {
    dataDir,
    split,
    chatModel,
    tenantConcurrency,
    enrichConcurrency,
    answer,
    evidenceOnly,
    selection,
    runId,
    resume,
    fresh,
    maxHistoryTurns: values.has('--max-history-turns')
      ? positiveInt('--max-history-turns', values.get('--max-history-turns')!)
      : null,
    relevanceFloor,
    reuseIngest,
    limitQueries: values.has('--limit-queries')
      ? positiveInt('--limit-queries', values.get('--limit-queries')!)
      : null,
    dryRun,
  }
}
