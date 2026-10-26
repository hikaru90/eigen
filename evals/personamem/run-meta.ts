import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveRunDir, writeFileAtomic } from '../public-bench/run-output'
import { answerModeSchema, relevanceFloorSchema, splitSchema } from './types'

export const BENCH = 'personamem-v2'

const runIdentitySchema = z.object({
  split: splitSchema,
  chatModel: z.string(),
  answer: answerModeSchema,
  evidenceOnly: z.boolean(),
  personaIds: z.array(z.number().int()),
  questionIds: z.array(z.string()),
  limitQueries: z.number().int().nullable(),
  enrichConcurrency: z.number().int(),
  relevanceFloor: relevanceFloorSchema,
  /** Run id whose ingest this run answers against; null = this run ingests. */
  reuseIngest: z.string().nullable(),
  /** REHEARSAL: user turns ingested per persona; null = the whole history. Absent in run.json files written before it existed. */
  maxHistoryTurns: z.number().int().positive().nullable().default(null),
})
export type RunIdentity = z.infer<typeof runIdentitySchema>

export const runMetaSchema = z.object({
  startedAt: z.string(),
  /**
   * Whether the run was created with `--fresh` (each tenant is reset before its first capture).
   * The run's fresh intent, fixed at creation: `--resume` cannot repeat `--fresh`, yet a resume
   * that reaches a tenant the earlier process never started (it was paused or stopped before
   * that tenant recorded a capture) must reset it exactly as the first start would have. It sits
   * beside `identity` rather than in it because a resume re-states the identity and is compared
   * against it, and a resume cannot re-state this; it is what the run was created as.
   *
   * run.json files written before this field existed did not record it, so nothing says whether
   * they were started with `--fresh`: they are read as `false` (not fresh) and never guessed
   * otherwise (not from processes.jsonl, not from anything else). Such a run keeps refusing a
   * tenant that holds thoughts, which is the safe direction.
   */
  fresh: z.boolean().default(false),
  identity: runIdentitySchema,
})
export type RunMeta = z.infer<typeof runMetaSchema>

export type RunPaths = {
  dir: string
  answers: string
  ingest: string
  smoke: string
  meta: string
  /** Per-capture ingest record (queued / enriched); what `--resume` continues from. */
  ingestProgress: string
  /** Per-question answer stages (eigen, choose-eigen, choose-no-memory). */
  answerStages: string
  /** Isolated tenant / question failures. */
  failures: string
  /** One start and one end row per process that worked on this run (counters, outcome). */
  processes: string
}

/** The run.json of an existing run (what `--reuse-ingest` verifies against). */
export function loadRunMeta(
  runId: string,
  reportsRoot?: string,
): { paths: RunPaths; meta: RunMeta } {
  const paths = runPaths(
    resolveRunDir({ bench: BENCH, runId, ...(reportsRoot ? { reportsRoot } : {}) }),
  )
  if (!existsSync(paths.meta)) throw new Error(`[personamem] run ${runId}: ${paths.meta} not found`)
  return { paths, meta: runMetaSchema.parse(JSON.parse(readFileSync(paths.meta, 'utf8'))) }
}

function runPaths(dir: string): RunPaths {
  return {
    dir,
    answers: join(dir, 'answers.jsonl'),
    ingest: join(dir, 'ingest.jsonl'),
    smoke: join(dir, 'smoke.jsonl'),
    meta: join(dir, 'run.json'),
    ingestProgress: join(dir, 'ingest-progress.jsonl'),
    answerStages: join(dir, 'answer-stages.jsonl'),
    failures: join(dir, 'failures.jsonl'),
    processes: join(dir, 'processes.jsonl'),
  }
}

/**
 * Creates the run directory, or (resume) verifies this invocation is the original one. A
 * different `--split`, `--answer`, `--relevance-floor` or `--reuse-ingest` is named explicitly:
 * rows of two splits (tuning vs reported), two answer paths or two floors are not comparable
 * within one run.
 *
 * `fresh` (the invocation's `--fresh`) is recorded in run.json when the run is created. A resume
 * cannot pass it (`--fresh` and `--resume` are mutually exclusive) and gets the recorded value
 * back in `meta.fresh`.
 */
export function openRun(input: {
  runId: string
  identity: RunIdentity
  resume: boolean
  /** The invocation's `--fresh`; always false on a resume. */
  fresh: boolean
  reportsRoot?: string
}): { paths: RunPaths; meta: RunMeta } {
  const { runId, identity, resume, fresh } = input
  const dir = resolveRunDir({
    bench: BENCH,
    runId,
    ...(input.reportsRoot ? { reportsRoot: input.reportsRoot } : {}),
  })
  const paths = runPaths(dir)

  if (resume) {
    if (fresh) {
      throw new Error(
        '[personamem] --fresh cannot be combined with --resume: whether a run is fresh is fixed when it is created (run.json) and a resume never changes it',
      )
    }
    if (!existsSync(paths.meta))
      throw new Error(`[personamem] cannot resume: ${paths.meta} not found`)
    const saved = runMetaSchema.parse(JSON.parse(readFileSync(paths.meta, 'utf8')))
    if (saved.identity.split !== identity.split) {
      throw new Error(
        `[personamem] cannot resume ${runId}: it was started with --split ${saved.identity.split}, this invocation says --split ${identity.split}`,
      )
    }
    if (saved.identity.answer !== identity.answer) {
      throw new Error(
        `[personamem] cannot resume ${runId}: it was started with --answer ${saved.identity.answer}, this invocation says --answer ${identity.answer}`,
      )
    }
    if (saved.identity.relevanceFloor !== identity.relevanceFloor) {
      throw new Error(
        `[personamem] cannot resume ${runId}: it was started with --relevance-floor ${saved.identity.relevanceFloor}, this invocation says --relevance-floor ${identity.relevanceFloor}`,
      )
    }
    if (saved.identity.reuseIngest !== identity.reuseIngest) {
      throw new Error(
        `[personamem] cannot resume ${runId}: it was started with --reuse-ingest ${saved.identity.reuseIngest ?? '(none)'}, this invocation says --reuse-ingest ${identity.reuseIngest ?? '(none)'}`,
      )
    }
    if (saved.identity.maxHistoryTurns !== identity.maxHistoryTurns) {
      throw new Error(
        `[personamem] cannot resume ${runId}: it was started with --max-history-turns ${saved.identity.maxHistoryTurns ?? '(none)'}, this invocation says --max-history-turns ${identity.maxHistoryTurns ?? '(none)'}`,
      )
    }
    if (JSON.stringify(saved.identity) !== JSON.stringify(identity)) {
      throw new Error(
        `[personamem] cannot resume ${runId}: this invocation differs from the original run\n` +
          `  original: ${JSON.stringify(saved.identity)}\n  now:      ${JSON.stringify(identity)}`,
      )
    }
    return { paths, meta: saved }
  }

  if (existsSync(paths.meta) || existsSync(paths.answers)) {
    throw new Error(
      `[personamem] run directory ${dir} already exists; use --resume or another --run-id`,
    )
  }
  const meta: RunMeta = { startedAt: new Date().toISOString(), fresh, identity }
  writeFileAtomic(paths.meta, `${JSON.stringify(meta, null, 2)}\n`)
  return { paths, meta }
}
