/**
 * PersonaMem-v2 live path: ingest each persona's user turns into its own tenant (`--ingest ask`:
 * replayed through one Ask chat session; `--ingest capture`: queued as captures), ask every
 * query through composeAnswer, let the chosen chat model pick an option with and without
 * Eigen's memories, write answers.jsonl (and ask-turns.jsonl) and the summary. Loaded only for real
 * runs (the dry run never imports this module). Agents do not run it; the operator does.
 */
import 'dotenv/config'
import type { PersonaMemCli } from './cli'
import { execFileSync } from 'node:child_process'
import { z } from 'zod'
import { PUBLIC_BENCH_OPERATOR_USER_ID } from '$lib/server/auth/harness-billing'
import { composeAnswer, formatComposedAnswerForUser } from '$lib/server/qa/compose-answer'
import { mapWithConcurrency } from '../harness/concurrency'
import { logEval, runEval, withEvalDb } from '../harness/eval-context'
import { tenantTotalUsd } from '../public-bench/cost'
import { ensurePublicBenchOperator } from '../public-bench/ensure-operator'
import { ingestTenant } from '../public-bench/ingest-tenant'
import { modelSlug } from '../public-bench/model-slug'
import { appendJsonl, readJsonl, removeJsonlRows, writeSummary } from '../public-bench/run-output'
import { ingestTenantViaAsk } from './ask-ingest'
import { chooseOption, llmComplete } from './choose-option'
import { chooseFromComposed, storedContextItems } from './eigen-answer'
import { buildChooserMessages } from './mcq'
import { buildPlan, type Plan, type PlannedPersona, type PlannedQuestion } from './plan'
import { openRun, type RunIdentity, type RunPaths } from './run-meta'
import { scoreAnswers } from './score'
import { buildSummary } from './summary'
import { answerRowSchema, askTurnRecordSchema, type AnswerRow, type AskTurnRecord } from './types'

const ingestRecordSchema = z.object({
  personaId: z.number().int(),
  tenantUserId: z.string(),
  /** Captures made: one per user turn (capture mode) or Ask's own capture_thought calls (ask mode, may be 0). */
  captures: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
  ms: z.number().nonnegative(),
})
type IngestRecord = z.infer<typeof ingestRecordSchema>

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

function parseRows<T>(label: string, rows: Record<string, unknown>[], schema: z.ZodType<T>): T[] {
  return rows.map((row, i) => {
    const parsed = schema.safeParse(row)
    if (!parsed.success) {
      throw new Error(`[personamem] ${label} row ${i + 1} is invalid: ${parsed.error.message}`)
    }
    return parsed.data
  })
}

function gitState(): { sha: string; dirty: boolean } {
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  return { sha: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0 }
}

/** Question ids with both variants written; a lone variant means a damaged run. */
function completedQuestionIds(rows: AnswerRow[]): Set<string> {
  const variantsById = new Map<string, Set<string>>()
  for (const row of rows) {
    const variants = variantsById.get(row.questionId) ?? new Set()
    variants.add(row.variant)
    variantsById.set(row.questionId, variants)
  }
  const done = new Set<string>()
  for (const [id, variants] of variantsById) {
    if (variants.size !== 2) {
      throw new Error(
        `[personamem] answers.jsonl has only [${[...variants]}] for ${id}; run is damaged`,
      )
    }
    done.add(id)
  }
  return done
}

type RunContext = {
  cli: PersonaMemCli
  paths: RunPaths
  done: Set<string>
  ingestedPersonaIds: Set<number>
}

async function answerQuestion(
  ctx: RunContext,
  persona: PlannedPersona,
  question: PlannedQuestion,
  usdBefore: number,
): Promise<number> {
  const { row, options, correctLetter } = question
  const tenant = persona.tenantUserId
  const billing = { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: ctx.cli.chatModel }
  const complete = llmComplete(tenant)

  const eigenStart = Date.now()
  const eigen = await withEvalDb(
    tenant,
    async () => {
      const composed = await composeAnswer({
        userId: tenant,
        question: row.query,
        referenceTime: persona.referenceTime,
      })
      const letter = await chooseFromComposed({ composed, query: row.query, options, complete })
      return { composed, letter }
    },
    billing,
  )
  const eigenMs = Date.now() - eigenStart
  const usdAfterEigen = await tenantTotalUsd(tenant)

  const noMemoryStart = Date.now()
  const noMemoryLetter = await withEvalDb(
    tenant,
    () =>
      chooseOption({
        messages: buildChooserMessages({ query: row.query, options, memories: null }),
        complete,
      }),
    billing,
  )
  const noMemoryMs = Date.now() - noMemoryStart
  const usdAfterNoMemory = await tenantTotalUsd(tenant)

  const usdOf = (from: number, to: number) => {
    const delta = round6(to - from)
    if (delta < 0)
      throw new Error(`[personamem] tenant ${tenant} spend went down (${from} -> ${to})`)
    return delta
  }
  const common = {
    questionId: row.questionId,
    personaId: row.personaId,
    prefType: row.prefType,
    updated: row.updated,
    who: row.who,
    correctLetter,
  }
  const eigenRow = answerRowSchema.parse({
    ...common,
    variant: 'eigen',
    letter: eigen.letter,
    correct: eigen.letter === correctLetter,
    eigenAnswer: formatComposedAnswerForUser(eigen.composed.answer),
    retrieved: storedContextItems(eigen.composed),
    citedIds: eigen.composed.retrieved.map((item) => item.id),
    usd: usdOf(usdBefore, usdAfterEigen),
    ms: eigenMs,
  })
  const noMemoryRow = answerRowSchema.parse({
    ...common,
    variant: 'no-memory',
    letter: noMemoryLetter,
    correct: noMemoryLetter === correctLetter,
    usd: usdOf(usdAfterEigen, usdAfterNoMemory),
    ms: noMemoryMs,
  })
  appendJsonl(ctx.paths.answers, eigenRow)
  appendJsonl(ctx.paths.answers, noMemoryRow)
  logEval(
    `${tenant} ${row.questionId}: eigen=${eigenRow.correct ? 'ok' : 'miss'} no-memory=${noMemoryRow.correct ? 'ok' : 'miss'}`,
  )
  return usdAfterNoMemory
}

async function runPersona(ctx: RunContext, persona: PlannedPersona): Promise<void> {
  const pending = persona.questions.filter((q) => !ctx.done.has(q.row.questionId))
  if (pending.length === 0) {
    logEval(
      `${persona.tenantUserId}: all ${persona.questions.length} question(s) answered, skipping`,
    )
    return
  }

  const tenant = persona.tenantUserId
  const reset = !ctx.cli.skipIngest && !ctx.ingestedPersonaIds.has(persona.personaId)
  const ingestStart = Date.now()
  let ingestedCaptures: number
  if (ctx.cli.ingest === 'ask') {
    // Persona granularity: a persona without an ingest record is replayed from scratch, so its
    // turn rows from an interrupted attempt are dropped first. (--skip-ingest is rejected by the CLI.)
    ingestedCaptures = 0
    if (reset) {
      removeJsonlRows(ctx.paths.askTurns, (row) => row.personaId === persona.personaId)
      const records = await ingestTenantViaAsk({
        tenantUserId: tenant,
        personaId: persona.personaId,
        billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
        chatModel: ctx.cli.chatModel,
        turns: persona.captures,
        enrichConcurrency: ctx.cli.enrichConcurrency,
        onTurn: (record) => appendJsonl(ctx.paths.askTurns, askTurnRecordSchema.parse(record)),
      })
      ingestedCaptures = records.reduce((sum, r) => sum + r.captures, 0)
    }
  } else {
    await ingestTenant({
      tenantUserId: tenant,
      billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
      chatModel: ctx.cli.chatModel,
      items: persona.captures,
      enrichConcurrency: ctx.cli.enrichConcurrency,
      reset,
    })
    ingestedCaptures = persona.captures.length
  }

  let usd = await tenantTotalUsd(tenant)
  if (reset) {
    const record: IngestRecord = {
      personaId: persona.personaId,
      tenantUserId: tenant,
      captures: ingestedCaptures,
      usd: round6(usd),
      ms: Date.now() - ingestStart,
    }
    appendJsonl(ctx.paths.ingest, record)
  }

  for (const question of pending) usd = await answerQuestion(ctx, persona, question, usd)
}

/** Every planned persona that has an ingest record must hold exactly one turn record per user turn. */
function assertAskTurnsComplete(
  plan: Plan,
  askTurns: readonly AskTurnRecord[],
  ingestRecords: readonly IngestRecord[],
): void {
  const ingested = new Set(ingestRecords.map((r) => r.personaId))
  for (const persona of plan.personas) {
    if (!ingested.has(persona.personaId)) {
      throw new Error(
        `[personamem] persona ${persona.personaId} has no ingest record; run is incomplete`,
      )
    }
    const turns = askTurns.filter((t) => t.personaId === persona.personaId)
    const indexes = turns.map((t) => t.turn).sort((a, b) => a - b)
    if (indexes.length !== persona.captures.length || indexes.some((n, i) => n !== i)) {
      throw new Error(
        `[personamem] ask-turns.jsonl holds ${indexes.length} turn record(s) for persona ${persona.personaId}, expected ${persona.captures.length}; run is damaged`,
      )
    }
  }
}

async function run(cli: PersonaMemCli): Promise<void> {
  const startedMs = Date.now()
  const plan = buildPlan(cli)
  logEval(
    `PersonaMem-v2 (--ingest ${cli.ingest}): ${plan.totals.personas} persona(s), ` +
      `${plan.totals.captures} user turn(s), ${plan.totals.queries} query(ies), chat model ${cli.chatModel}`,
  )

  const models = await ensurePublicBenchOperator({
    operatorUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
    displayName: 'Public Bench Runner',
    chatModel: cli.chatModel,
  })

  const runId =
    cli.runId ?? `${modelSlug(cli.chatModel)}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const identity: RunIdentity = {
    chatModel: cli.chatModel,
    ingest: cli.ingest,
    personaIds: plan.personas.map((p) => p.personaId),
    limitQueries: cli.limitQueries,
    enrichConcurrency: cli.enrichConcurrency,
  }
  const { paths, meta } = openRun({ runId, identity, resume: cli.resume })
  const existing = parseRows('answers.jsonl', readJsonl(paths.answers), answerRowSchema)
  const ctx: RunContext = {
    cli,
    paths,
    done: completedQuestionIds(existing),
    ingestedPersonaIds: new Set(
      parseRows('ingest.jsonl', readJsonl(paths.ingest), ingestRecordSchema).map(
        (r) => r.personaId,
      ),
    ),
  }
  logEval(`run ${runId}: ${paths.dir} (${ctx.done.size} question(s) already answered)`)

  await mapWithConcurrency(plan.personas, cli.tenantConcurrency, (persona) =>
    runPersona(ctx, persona),
  )

  const rows = parseRows('answers.jsonl', readJsonl(paths.answers), answerRowSchema)
  const distanceByQuestionId = new Map(
    plan.personas.flatMap((p) =>
      p.questions.map((q) => [q.row.questionId, q.row.distance32k] as const),
    ),
  )
  const extra = rows.find((r) => !distanceByQuestionId.has(r.questionId))
  if (extra)
    throw new Error(
      `[personamem] answers.jsonl holds ${extra.questionId}, which is not in the plan`,
    )
  const answered = new Set(rows.map((r) => r.questionId))
  const missing = [...distanceByQuestionId.keys()].filter((id) => !answered.has(id))
  if (missing.length > 0) {
    throw new Error(
      `[personamem] run incomplete: ${missing.length} question(s) unanswered, e.g. ${missing[0]}`,
    )
  }
  const score = scoreAnswers(rows, distanceByQuestionId)

  const ingestRecords = parseRows('ingest.jsonl', readJsonl(paths.ingest), ingestRecordSchema)
  const askTurns =
    cli.ingest === 'ask'
      ? parseRows('ask-turns.jsonl', readJsonl(paths.askTurns), askTurnRecordSchema)
      : []
  if (cli.ingest === 'ask') assertAskTurnsComplete(plan, askTurns, ingestRecords)
  const git = gitState()
  writeSummary(
    paths.dir,
    buildSummary({
      runId,
      chatModel: cli.chatModel,
      startedAt: meta.startedAt,
      finishedAt: new Date().toISOString(),
      config: {
        dataset: 'PersonaMem-v2 text, chat_history_32k',
        dataDir: cli.dataDir,
        selection: cli.selection,
        personaIds: meta.identity.personaIds,
        limitQueries: cli.limitQueries,
        tenantConcurrency: cli.tenantConcurrency,
        enrichConcurrency: cli.enrichConcurrency,
        skipIngest: cli.skipIngest,
        resumed: cli.resume,
        operator: PUBLIC_BENCH_OPERATOR_USER_ID,
        modelChat: models.modelChat,
        modelEmbedding: models.modelEmbedding,
      },
      score,
      ingestMode: cli.ingest,
      askTurns,
      ingest: {
        usd: ingestRecords.reduce((sum, r) => sum + r.usd, 0),
        captures: ingestRecords.reduce((sum, r) => sum + r.captures, 0),
        personas: ingestRecords.length,
      },
      wallMsThisProcess: Date.now() - startedMs,
      gitSha: git.sha,
      gitDirty: git.dirty,
    }),
  )
  logEval(
    `done: eigen ${(score.overall.eigenAccuracy * 100).toFixed(1)}%, ` +
      `no-memory ${(score.overall.noMemoryAccuracy * 100).toFixed(1)}%; summary in ${paths.dir}`,
  )
}

export async function runLive(cli: PersonaMemCli): Promise<void> {
  await runEval(() => run(cli))
}
