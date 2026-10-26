import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveRunDir } from '../public-bench/run-output'
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
})
export type RunIdentity = z.infer<typeof runIdentitySchema>

export const runMetaSchema = z.object({ startedAt: z.string(), identity: runIdentitySchema })
export type RunMeta = z.infer<typeof runMetaSchema>

export type RunPaths = {
  dir: string
  answers: string
  ingest: string
  smoke: string
  meta: string
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
  }
}

/**
 * Creates the run directory, or (resume) verifies this invocation is the original one. A
 * different `--split`, `--answer`, `--relevance-floor` or `--reuse-ingest` is named explicitly:
 * rows of two splits (tuning vs reported), two answer paths or two floors are not comparable
 * within one run.
 */
export function openRun(input: {
  runId: string
  identity: RunIdentity
  resume: boolean
  reportsRoot?: string
}): { paths: RunPaths; meta: RunMeta } {
  const { runId, identity, resume } = input
  const dir = resolveRunDir({
    bench: BENCH,
    runId,
    ...(input.reportsRoot ? { reportsRoot: input.reportsRoot } : {}),
  })
  const paths = runPaths(dir)

  if (resume) {
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
  const meta: RunMeta = { startedAt: new Date().toISOString(), identity }
  mkdirSync(dir, { recursive: true })
  writeFileSync(paths.meta, `${JSON.stringify(meta, null, 2)}\n`)
  return { paths, meta }
}
