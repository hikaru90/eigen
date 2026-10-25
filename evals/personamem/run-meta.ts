import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveRunDir } from '../public-bench/run-output'
import { answerModeSchema } from './types'

export const BENCH = 'personamem-v2'

const runIdentitySchema = z.object({
  chatModel: z.string(),
  answer: answerModeSchema,
  evidenceOnly: z.boolean(),
  personaIds: z.array(z.number().int()),
  questionIds: z.array(z.string()),
  limitQueries: z.number().int().nullable(),
  enrichConcurrency: z.number().int(),
})
export type RunIdentity = z.infer<typeof runIdentitySchema>

const runMetaSchema = z.object({ startedAt: z.string(), identity: runIdentitySchema })
export type RunMeta = z.infer<typeof runMetaSchema>

export type RunPaths = {
  dir: string
  answers: string
  ingest: string
  smoke: string
  meta: string
}

/**
 * Creates the run directory, or (resume) verifies this invocation is the original one. A
 * different `--answer` is named explicitly: the two modes answer through different paths, so
 * their answers are not comparable within one run.
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
  const paths: RunPaths = {
    dir,
    answers: join(dir, 'answers.jsonl'),
    ingest: join(dir, 'ingest.jsonl'),
    smoke: join(dir, 'smoke.jsonl'),
    meta: join(dir, 'run.json'),
  }

  if (resume) {
    if (!existsSync(paths.meta))
      throw new Error(`[personamem] cannot resume: ${paths.meta} not found`)
    const saved = runMetaSchema.parse(JSON.parse(readFileSync(paths.meta, 'utf8')))
    if (saved.identity.answer !== identity.answer) {
      throw new Error(
        `[personamem] cannot resume ${runId}: it was started with --answer ${saved.identity.answer}, this invocation says --answer ${identity.answer}`,
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
