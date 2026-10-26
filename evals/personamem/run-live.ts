/**
 * PersonaMem-v2 live path: queue each tenant's user turns as captures (the whole history, or
 * with --evidence-only just one question's evidence), answer every query (`--answer ask`: the
 * real Ask agent; `--answer compose`: composeAnswer on the bare query), let the chosen chat
 * model pick an option with and without Eigen's memories, write answers.jsonl (and smoke.jsonl)
 * and the summary. Loaded only for real runs (the dry run never imports this module). Agents do
 * not run it; the operator does.
 */
import 'dotenv/config'
import type { PersonaMemCli } from './cli'
import { execFileSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { PUBLIC_BENCH_OPERATOR_USER_ID } from '$lib/server/auth/harness-billing'
import type { RetrievalContextItem } from '$lib/server/qa/compose-answer'
import { mapWithConcurrency } from '../harness/concurrency'
import { logEval, runEval, withEvalDb } from '../harness/eval-context'
import { tenantTotalUsd } from '../public-bench/cost'
import { ensurePublicBenchOperator } from '../public-bench/ensure-operator'
import { ingestTenant } from '../public-bench/ingest-tenant'
import { modelSlug } from '../public-bench/model-slug'
import { appendJsonl, readJsonl, removeJsonlRows, writeSummary } from '../public-bench/run-output'
import { answerViaAsk } from './ask-answer'
import { chooseOption, llmComplete } from './choose-option'
import { answerViaCompose } from './compose-direct'
import { chooseFromComposed, storedContextItems } from './eigen-answer'
import { evidenceHitFor, captureFamilies } from './evidence-items'
import { loadTenantStructure } from './evidence-items-db'
import { captureDigest, ingestRecordSchema, type IngestRecord } from './ingest-record'
import { buildChooserMessages } from './mcq'
import { buildPlan, type Plan, type PlannedPersona, type PlannedQuestion } from './plan'
import { loadIngestSource, verifyIngestRecords, verifyLiveTenant } from './reuse-ingest'
import { withRunRelevanceFloor } from './run-floor'
import { openRun, type RunIdentity, type RunPaths } from './run-meta'
import { scoreAnswers } from './score'
import { buildSummary, formatScoreLines, type SmokeBlock } from './summary'
import { answerRowSchema, type AnswerRow, type BelowFloor } from './types'

/** One line of smoke.jsonl (--evidence-only): the tenant's thoughts after ingest. */
const smokeRecordSchema = z.object({
  questionId: z.string(),
  stored: z.array(z.object({ text: z.string(), createdAt: z.iso.datetime() })),
})
type SmokeRecord = z.infer<typeof smokeRecordSchema>

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
  /** Verified ingest record of every tenant already ingested (by this run, or by the --reuse-ingest run). */
  ingested: Map<string, IngestRecord>
  /** Per tenant: the stored items (thought, split children, linked notes) each capture thought became. */
  families: Map<string, Map<string, Set<string>>>
}

/** normalizedText of every thought in the tenant (what Eigen stored from the ingested turns). */
async function storedThoughts(tenant: string, cli: PersonaMemCli): Promise<SmokeRecord['stored']> {
  const billing = { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: cli.chatModel }
  const { thought } = await import('$lib/server/db/schema')
  const rows = await withEvalDb(
    tenant,
    (db) =>
      db
        .select({ text: thought.normalizedText, createdAt: thought.createdAt })
        .from(thought)
        .where(eq(thought.userId, tenant)),
    billing,
  )
  return rows
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({ text: r.text, createdAt: r.createdAt.toISOString() }))
}

type EigenAnswer = {
  answerText: string
  context: RetrievalContextItem[]
  citedIds: string[]
  belowFloor: BelowFloor
  askTools?: string[]
  askAnsweredWithoutMemory?: boolean
}

async function eigenAnswerFor(
  ctx: RunContext,
  tenant: string,
  persona: PlannedPersona,
  query: string,
): Promise<EigenAnswer> {
  const billing = { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: ctx.cli.chatModel }
  // the run's relevance floor covers everything the answer retrieves (composeAnswer, note search)
  return withRunRelevanceFloor(ctx.cli.relevanceFloor, async (): Promise<EigenAnswer> => {
    if (ctx.cli.answer === 'ask') {
      const asked = await answerViaAsk({
        tenantUserId: tenant,
        query,
        referenceTime: persona.referenceTime,
        billing,
      })
      return {
        answerText: asked.answer,
        context: asked.context,
        citedIds: [],
        belowFloor: asked.belowFloor,
        askTools: asked.toolNames,
        askAnsweredWithoutMemory: asked.askAnsweredWithoutMemory,
      }
    }
    return answerViaCompose({
      tenantUserId: tenant,
      query,
      referenceTime: persona.referenceTime,
      billing,
    })
  })
}

async function answerQuestion(
  ctx: RunContext,
  persona: PlannedPersona,
  question: PlannedQuestion,
  record: IngestRecord,
  usdBefore: number,
): Promise<number> {
  const { row, options, correctLetter } = question
  const tenant = persona.tenantUserId
  const billing = { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: ctx.cli.chatModel }
  const complete = llmComplete(tenant)

  const eigenStart = Date.now()
  const eigen = await eigenAnswerFor(ctx, tenant, persona, row.query)
  const letter = await withEvalDb(
    tenant,
    () => chooseFromComposed({ composed: eigen, query: row.query, options, complete }),
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
  const families = ctx.families.get(tenant)
  if (!families) throw new Error(`[personamem] no capture families loaded for tenant ${tenant}`)
  const evidence = evidenceHitFor(question.evidence, record.thoughtIds, families, eigen.context)
  const eigenRow = answerRowSchema.parse({
    ...common,
    variant: 'eigen',
    letter,
    correct: letter === correctLetter,
    eigenAnswer: eigen.answerText,
    retrieved: storedContextItems(eigen),
    citedIds: eigen.citedIds,
    belowFloor: eigen.belowFloor,
    ...(evidence ? { evidence } : {}),
    ...(eigen.askTools ? { askTools: eigen.askTools } : {}),
    ...(eigen.askAnsweredWithoutMemory !== undefined
      ? { askAnsweredWithoutMemory: eigen.askAnsweredWithoutMemory }
      : {}),
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
  const billing = { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: ctx.cli.chatModel }
  let record = ctx.ingested.get(tenant)
  if (record === undefined) {
    if (ctx.cli.reuseIngest !== null) {
      throw new Error(`[personamem] tenant ${tenant} has no verified ingest record to reuse`)
    }
    const ingestStart = Date.now()
    const thoughtIds = await ingestTenant({
      tenantUserId: tenant,
      billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
      chatModel: ctx.cli.chatModel,
      items: persona.captures,
      enrichConcurrency: ctx.cli.enrichConcurrency,
    })
    const structure = await loadTenantStructure(tenant, billing)
    record = {
      personaId: persona.personaId,
      tenantUserId: tenant,
      captures: persona.captures.length,
      captureDigest: captureDigest(persona.captures),
      thoughtIds,
      thoughtCount: structure.thoughts.length,
      usd: round6(await tenantTotalUsd(tenant)),
      ms: Date.now() - ingestStart,
    }
    appendJsonl(ctx.paths.ingest, ingestRecordSchema.parse(record))
    ctx.ingested.set(tenant, record)
    ctx.families.set(tenant, captureFamilies(thoughtIds, structure.thoughts, structure.links))
  }

  let usd = await tenantTotalUsd(tenant)

  if (ctx.cli.evidenceOnly) {
    // Evidence-only: one question per tenant. Record what Eigen stored from the evidence turns.
    for (const question of pending) {
      const record: SmokeRecord = {
        questionId: question.row.questionId,
        stored: await storedThoughts(tenant, ctx.cli),
      }
      removeJsonlRows(ctx.paths.smoke, (r) => r.questionId === record.questionId)
      appendJsonl(ctx.paths.smoke, record)
    }
  }

  for (const question of pending) usd = await answerQuestion(ctx, persona, question, record, usd)
}

function smokeBlocks(
  plan: Plan,
  rows: readonly AnswerRow[],
  stored: readonly SmokeRecord[],
): SmokeBlock[] {
  return plan.personas.map((persona) => {
    const { row, correctLetter, options } = persona.questions[0]!
    const eigen = rows.find((r) => r.questionId === row.questionId && r.variant === 'eigen')
    const noMemory = rows.find((r) => r.questionId === row.questionId && r.variant === 'no-memory')
    const record = stored.find((r) => r.questionId === row.questionId)
    if (!eigen || !noMemory || !record) {
      throw new Error(`[personamem] smoke data for ${row.questionId} is incomplete; run is damaged`)
    }
    if (!eigen.belowFloor) {
      throw new Error(
        `[personamem] eigen row for ${row.questionId} has no belowFloor; run is damaged or predates it`,
      )
    }
    return {
      questionId: row.questionId,
      prefType: row.prefType,
      belowFloor: eigen.belowFloor,
      query: row.query,
      preference: row.preference,
      evidenceUserTurns: persona.captures.map((c) => c.rawText),
      stored: record.stored,
      context: (eigen.retrieved ?? []).map((r) => ({
        text: r.normalizedText,
        storedAt: r.createdAt,
      })),
      askTools: eigen.askTools ?? null,
      askAnsweredWithoutMemory: eigen.askAnsweredWithoutMemory === true,
      correctAnswer: options[correctLetter],
      eigenLetter: eigen.letter,
      noMemoryLetter: noMemory.letter,
      correctLetter,
    }
  })
}

type VerifiedIngest = {
  records: Map<string, IngestRecord>
  families: Map<string, Map<string, Set<string>>>
}

const emptyIngest = (): VerifiedIngest => ({ records: new Map(), families: new Map() })

/**
 * The ingest records of `sourceRunId` that match this plan, each checked against the tenant in
 * the database (every recorded thought exists, the thought count is unchanged). Throws on any
 * mismatch, before anything is answered.
 */
async function verifiedIngest(
  cli: PersonaMemCli,
  sourceRunId: string,
  plan: Plan,
  requireAll: boolean,
): Promise<VerifiedIngest> {
  const records = verifyIngestRecords({
    sourceRunId,
    source: loadIngestSource(sourceRunId),
    current: cli,
    planned: plan.personas,
    requireAll,
  })
  const billing = { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: cli.chatModel }
  const families = new Map<string, Map<string, Set<string>>>()
  await mapWithConcurrency([...records.values()], cli.tenantConcurrency, async (record) => {
    const structure = await loadTenantStructure(record.tenantUserId, billing)
    verifyLiveTenant({
      sourceRunId,
      record,
      live: {
        thoughtIds: new Set(structure.thoughts.map((t) => t.id)),
        thoughtCount: structure.thoughts.length,
      },
    })
    families.set(
      record.tenantUserId,
      captureFamilies(record.thoughtIds, structure.thoughts, structure.links),
    )
  })
  logEval(`ingest of run ${sourceRunId} verified against the database: ${records.size} tenant(s)`)
  return { records, families }
}

async function run(cli: PersonaMemCli): Promise<void> {
  const startedMs = Date.now()
  const plan = buildPlan(cli)
  logEval(
    `PersonaMem-v2 (--split ${cli.split}, --answer ${cli.answer}${cli.evidenceOnly ? ', SMOKE evidence-only' : ''}): ${plan.totals.personas} tenant(s), ` +
      `${plan.totals.captures} capture(s), ${plan.totals.queries} query(ies), chat model ${cli.chatModel}`,
  )

  const models = await ensurePublicBenchOperator({
    operatorUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
    displayName: 'Public Bench Runner',
    chatModel: cli.chatModel,
  })

  const runId =
    cli.runId ?? `${modelSlug(cli.chatModel)}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const identity: RunIdentity = {
    split: cli.split,
    chatModel: cli.chatModel,
    answer: cli.answer,
    evidenceOnly: cli.evidenceOnly,
    personaIds: [...new Set(plan.personas.map((p) => p.personaId))],
    questionIds: plan.personas.flatMap((p) => p.questions.map((q) => q.row.questionId)),
    limitQueries: cli.limitQueries,
    enrichConcurrency: cli.enrichConcurrency,
    relevanceFloor: cli.relevanceFloor,
    reuseIngest: cli.reuseIngest,
  }
  // --reuse-ingest is checked before this run's directory exists: a mismatch must leave nothing behind
  const reused =
    cli.reuseIngest === null ? null : await verifiedIngest(cli, cli.reuseIngest, plan, true)
  const { paths, meta } = openRun({ runId, identity, resume: cli.resume })
  // --resume: tenants this run already ingested are verified like reused ones
  const ingested =
    reused ?? (cli.resume ? await verifiedIngest(cli, runId, plan, false) : emptyIngest())
  const existing = parseRows('answers.jsonl', readJsonl(paths.answers), answerRowSchema)
  const ctx: RunContext = {
    cli,
    paths,
    done: completedQuestionIds(existing),
    ingested: ingested.records,
    families: ingested.families,
  }
  logEval(
    `run ${runId}: ${paths.dir} (${ctx.done.size} question(s) already answered; relevance floor ${cli.relevanceFloor}` +
      `${cli.reuseIngest === null ? '' : `; ingest reused from run ${cli.reuseIngest}`}, ${ctx.ingested.size} tenant(s) already ingested)`,
  )

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
  const smoke = cli.evidenceOnly
    ? smokeBlocks(plan, rows, parseRows('smoke.jsonl', readJsonl(paths.smoke), smokeRecordSchema))
    : []
  const git = gitState()
  writeSummary(
    paths.dir,
    buildSummary({
      runId,
      chatModel: cli.chatModel,
      startedAt: meta.startedAt,
      finishedAt: new Date().toISOString(),
      split: cli.split,
      config: {
        dataset: 'PersonaMem-v2 text, chat_history_32k',
        dataDir: cli.dataDir,
        selection: cli.selection,
        personaIds: meta.identity.personaIds,
        limitQueries: cli.limitQueries,
        tenantConcurrency: cli.tenantConcurrency,
        enrichConcurrency: cli.enrichConcurrency,
        relevanceFloor: cli.relevanceFloor,
        reuseIngest: cli.reuseIngest,
        resumed: cli.resume,
        operator: PUBLIC_BENCH_OPERATOR_USER_ID,
        modelChat: models.modelChat,
        modelEmbedding: models.modelEmbedding,
      },
      score,
      answerMode: cli.answer,
      evidenceOnly: cli.evidenceOnly,
      smoke,
      relevanceFloor: cli.relevanceFloor,
      reuseIngest: cli.reuseIngest,
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
  logEval(`done (${cli.split} split): summary in ${paths.dir}`)
  for (const line of formatScoreLines(score, cli.relevanceFloor)) logEval(line)
}

export async function runLive(cli: PersonaMemCli): Promise<void> {
  await runEval(() => run(cli))
}
