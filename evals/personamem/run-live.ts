/**
 * PersonaMem-v2 live path: queue each tenant's user turns as captures (the whole history, or
 * with --evidence-only just one question's evidence), answer every query (`--answer ask`: the
 * real Ask agent; `--answer compose`: composeAnswer on the bare query), let the chosen chat
 * model pick an option with and without Eigen's memories, write answers.jsonl (and smoke.jsonl)
 * and the summary. Loaded only for real runs (the dry run never imports this module). Agents do
 * not run it; the operator does.
 *
 * Durable by design (docs/planning/durable-benchmark-runs.md): paid responses are cached on
 * disk before use, ingest and answers are recorded per capture / per stage, a tenant or a
 * question that fails is recorded and isolated, a signal stops the run cleanly, and everything
 * is checked before the first paid call. After a hard kill `--resume` repeats nothing that
 * completed.
 */
import 'dotenv/config'
import type { PersonaMemCli } from './cli'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { PUBLIC_BENCH_OPERATOR_USER_ID } from '$lib/server/auth/harness-billing'
import { createEvalLlmCache, withEvalLlmCache } from '$lib/server/llm/eval-llm-cache'
import type { RetrievalContextItem } from '$lib/server/qa/compose-answer'
import { mapWithConcurrency } from '../harness/concurrency'
import { createCallAccounting, killSelf, resolveCrashSpec } from '../harness/crash-hook'
import { logEval, runEval, withEvalDb } from '../harness/eval-context'
import {
  caffeinateAdvice,
  fetchOpenRouterKeyInfo,
  isUnderCaffeinate,
  pendingMigrationTags,
  psParentOf,
  throwIfProblems,
} from '../harness/preflight'
import { createStopController } from '../harness/stop-signal'
import { tenantTotalUsd } from '../public-bench/cost'
import {
  assertPublicBenchGatewayEnv,
  ensurePublicBenchOperator,
} from '../public-bench/ensure-operator'
import { readFailures } from '../public-bench/failures'
import { emptyTenantProgress, loadIngestProgress } from '../public-bench/ingest-progress'
import { ingestTenant, type IngestCounters } from '../public-bench/ingest-tenant'
import {
  appendProcessCrash,
  appendProcessEnd,
  appendProcessStart,
  formatCounterLines,
  type ProcessCounters,
  type ProcessOutcome,
} from '../public-bench/process-log'
import {
  appendJsonl,
  EVAL_LLM_CACHE_DIR,
  readJsonl,
  removeJsonlRows,
  resolveRunDir,
  writeSummary,
} from '../public-bench/run-output'
import { loadAnswerStages, nextStage } from './answer-stages'
import { answerViaAsk } from './ask-answer'
import { chooseOption, llmComplete } from './choose-option'
import { answerViaCompose } from './compose-direct'
import { chooseFromComposed, storedContextItems } from './eigen-answer'
import { evidenceHitFor, captureFamilies } from './evidence-items'
import { loadTenantStructure } from './evidence-items-db'
import { captureDigest, ingestRecordSchema, type IngestRecord } from './ingest-record'
import { createIngestStore } from './ingest-store'
import { buildChooserMessages } from './mcq'
import { buildPlan, type Plan, type PlannedPersona, type PlannedQuestion } from './plan'
import { livePreflightProblems, staticPreflightProblems, type LiveChecks } from './preflight'
import { buildRunCommand, buildResumeCommand } from './resume-command'
import { loadIngestSource, verifyIngestRecords, verifyLiveTenant } from './reuse-ingest'
import { withRunRelevanceFloor } from './run-floor'
import { BENCH, openRun, type RunIdentity, type RunPaths } from './run-meta'
import { runPersonas, summarizeRun } from './run-orchestrator'
import { scoreAnswers } from './score'
import { answerStaged, healLoneVariants, type EigenOutcome } from './staged-answer'
import { buildIncompleteSummary, buildSummary, formatScoreLines, type SmokeBlock } from './summary'
import { answerRowSchema, type AnswerRow, type BelowFloor } from './types'

/** One line of smoke.jsonl (--evidence-only): the tenant's thoughts after ingest. */
const smokeRecordSchema = z.object({
  questionId: z.string(),
  stored: z.array(z.object({ text: z.string(), createdAt: z.iso.datetime() })),
})
type SmokeRecord = z.infer<typeof smokeRecordSchema>

const round6 = (x: number) => Math.round(x * 1e6) / 1e6

const REPO_ROOT = resolve(import.meta.dirname, '../..')

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

/** Question ids with both variants written (a lone variant was healed away before this is called). */
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
  billing: { billingUserId: string; chatModel: string }
  done: Set<string>
  /** Verified ingest record of every tenant already ingested (by this run, or by the --reuse-ingest run). */
  ingested: Map<string, IngestRecord>
  /** Per tenant: the stored items (thought, split children, linked notes) each capture thought became. */
  families: Map<string, Map<string, Set<string>>>
  /** Per-capture ingest state recorded by earlier processes of this run. */
  ingestProgress: ReturnType<typeof loadIngestProgress>
  /** Answer stages stored by earlier processes. */
  stages: ReturnType<typeof loadAnswerStages>
  accounting: ReturnType<typeof createCallAccounting>
  stop: ReturnType<typeof createStopController>
  counters: {
    ingest: IngestCounters
    answers: ProcessCounters['answers']
  }
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
  const { billing } = ctx
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

/** Stages a question already has stored (0..3): the work a resume does not repeat. */
const storedStageCount = (stage: ReturnType<typeof nextStage>): number =>
  ({ eigen: 0, 'choose-eigen': 1, 'choose-no-memory': 2, complete: 3 })[stage]

async function answerQuestion(
  ctx: RunContext,
  persona: PlannedPersona,
  question: PlannedQuestion,
): Promise<void> {
  const { row, options, correctLetter } = question
  const tenant = persona.tenantUserId
  const { billing } = ctx
  const record = ctx.ingested.get(tenant)
  if (record === undefined) throw new Error(`[personamem] tenant ${tenant} has no ingest record`)
  const families = ctx.families.get(tenant)
  if (!families) throw new Error(`[personamem] no capture families loaded for tenant ${tenant}`)
  const complete = llmComplete(tenant)
  const stored = ctx.stages.get(row.questionId)

  if (ctx.cli.evidenceOnly) {
    // Evidence-only: one question per tenant. Record what Eigen stored from the evidence turns.
    const smoke: SmokeRecord = {
      questionId: row.questionId,
      stored: await storedThoughts(tenant, ctx.cli),
    }
    removeJsonlRows(ctx.paths.smoke, (r) => r.questionId === smoke.questionId)
    appendJsonl(ctx.paths.smoke, smoke)
  }

  await ctx.accounting.withPhase('answer', () =>
    answerStaged({
      question: {
        questionId: row.questionId,
        personaId: row.personaId,
        prefType: row.prefType,
        updated: row.updated,
        who: row.who,
        correctLetter,
      },
      paths: { stages: ctx.paths.answerStages, answers: ctx.paths.answers },
      stages: stored,
      spend: () => tenantTotalUsd(tenant),
      runEigen: async (): Promise<EigenOutcome> => {
        const eigen = await eigenAnswerFor(ctx, tenant, persona, row.query)
        const evidence = evidenceHitFor(
          question.evidence,
          record.thoughtIds,
          families,
          eigen.context,
        )
        return {
          answerText: eigen.answerText,
          retrieved: storedContextItems(eigen),
          citedIds: eigen.citedIds,
          belowFloor: eigen.belowFloor,
          ...(evidence ? { evidence } : {}),
          ...(eigen.askTools ? { askTools: eigen.askTools } : {}),
          ...(eigen.askAnsweredWithoutMemory !== undefined
            ? { askAnsweredWithoutMemory: eigen.askAnsweredWithoutMemory }
            : {}),
        }
      },
      runChooseEigen: (eigenStage) =>
        withEvalDb(
          tenant,
          () =>
            chooseFromComposed({
              composed: {
                context: eigenStage.retrieved.map((item) => ({
                  normalizedText: item.normalizedText,
                  createdAt: new Date(item.createdAt),
                })),
              },
              query: row.query,
              options,
              complete,
            }),
          billing,
        ),
      runChooseNoMemory: () =>
        withEvalDb(
          tenant,
          () =>
            chooseOption({
              messages: buildChooserMessages({ query: row.query, options, memories: null }),
              complete,
            }),
          billing,
        ),
    }),
  )
  ctx.done.add(row.questionId)
  ctx.counters.answers.answeredNow += 1
  ctx.counters.answers.stagesReused += storedStageCount(nextStage(stored))
  logEval(
    `${tenant} ${row.questionId}: answered (${storedStageCount(nextStage(stored))}/3 stage(s) were stored)`,
  )
}

async function ingestPersona(ctx: RunContext, persona: PlannedPersona): Promise<void> {
  const tenant = persona.tenantUserId
  const { billing } = ctx
  const ingestStart = Date.now()
  const thoughtIds = await ctx.accounting.withPhase('ingest', () =>
    ingestTenant({
      tenantUserId: tenant,
      billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
      chatModel: ctx.cli.chatModel,
      items: persona.captures,
      enrichConcurrency: ctx.cli.enrichConcurrency,
      durable: {
        progressPath: ctx.paths.ingestProgress,
        progress: ctx.ingestProgress.get(tenant) ?? emptyTenantProgress(),
        fresh: ctx.cli.fresh,
        store: createIngestStore(billing),
        counters: ctx.counters.ingest,
        shouldStop: () => ctx.stop.stopRequested(),
      },
    }),
  )
  const structure = await loadTenantStructure(tenant, billing)
  const record: IngestRecord = {
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

/** The live reads of the preflight: the database, the OpenRouter key and the harness wallet. */
function liveChecks(
  cli: PersonaMemCli,
  onModels: (models: { modelChat: string; modelEmbedding: string }) => void,
): LiveChecks {
  return {
    async checkDatabase() {
      const { appSql } = await import('$lib/server/db')
      let reserved: Awaited<ReturnType<typeof appSql.reserve>>
      try {
        reserved = await appSql.reserve()
      } catch (err) {
        return [`database is not reachable: ${err instanceof Error ? err.message : err}`]
      }
      try {
        await reserved`SELECT 1`
        const journal = JSON.parse(
          readFileSync(join(REPO_ROOT, 'drizzle/meta/_journal.json'), 'utf8'),
        ) as { entries: { tag: string }[] }
        let applied: { hash: string }[]
        try {
          applied = await reserved`SELECT hash FROM drizzle.__drizzle_migrations`
        } catch (err) {
          return [
            `migrations table drizzle.__drizzle_migrations cannot be read (${err instanceof Error ? err.message : err}); run npm run db:migrate`,
          ]
        }
        const pending = pendingMigrationTags({
          journalTags: journal.entries.map((e) => e.tag),
          readSql: (tag) => readFileSync(join(REPO_ROOT, 'drizzle', `${tag}.sql`), 'utf8'),
          hashOf: (sql) => createHash('sha256').update(sql).digest('hex'),
          appliedHashes: new Set(applied.map((r) => r.hash)),
        })
        return pending.length === 0
          ? []
          : [`migrations not applied: ${pending.join(', ')} (run npm run db:migrate)`]
      } catch (err) {
        return [`database check failed: ${err instanceof Error ? err.message : err}`]
      } finally {
        await reserved.release()
      }
    },
    async fetchKeyInfo() {
      const baseUrl = process.env.OPENROUTER_BASE_URL?.trim()
      const apiKey = process.env.SERVICE_API_KEY_OPENROUTER?.trim()
      if (!baseUrl || !apiKey)
        throw new Error('OPENROUTER_BASE_URL / SERVICE_API_KEY_OPENROUTER missing')
      const info = await fetchOpenRouterKeyInfo({ baseUrl, apiKey, fetchFn: fetch })
      logEval(
        `preflight: OpenRouter key has ${info.limitRemaining === null ? 'no limit set' : `$${info.limitRemaining.toFixed(2)} left`} (used $${info.usage.toFixed(2)})`,
      )
      return info
    },
    async walletCredits() {
      // the operator exists with a funded wallet before its balance is read
      onModels(
        await ensurePublicBenchOperator({
          operatorUserId: PUBLIC_BENCH_OPERATOR_USER_ID,
          displayName: 'Public Bench Runner',
          chatModel: cli.chatModel,
        }),
      )
      const { getOrCreateWallet } = await import('$lib/server/billing/wallet')
      const wallet = await getOrCreateWallet(PUBLIC_BENCH_OPERATOR_USER_ID)
      logEval(
        `preflight: harness wallet has ${wallet.availableCredits.toLocaleString('en-US')} credits`,
      )
      return wallet.availableCredits
    },
  }
}

/** Everything that must hold before the first paid call; throws one error naming all that does not. */
async function preflight(
  cli: PersonaMemCli,
  runDir: string,
  onModels: (models: { modelChat: string; modelEmbedding: string }) => void,
): Promise<{ plan: Plan }> {
  // the gateway env first, with its own complete message (OPENROUTER_BASE_URL / SERVICE_API_KEY_OPENROUTER)
  assertPublicBenchGatewayEnv(process.env)
  throwIfProblems(
    staticPreflightProblems({
      dataDir: cli.dataDir,
      split: cli.split,
      // the run directory itself is created by openRun; its parent must be writable now
      runDir: dirname(runDir),
      env: process.env,
    }),
  )
  const plan = buildPlan(cli)

  const argv = process.argv.slice(2)
  if (!isUnderCaffeinate({ platform: process.platform, pid: process.pid, parentOf: psParentOf })) {
    console.warn(
      `[eval] WARNING: this process is not running under caffeinate; the machine may sleep mid-run. Use:\n  ${caffeinateAdvice(buildRunCommand(argv).replace(/^caffeinate -i /, ''))}`,
    )
  }

  const { totalCostUsdToCredits } = await import('$lib/billing/platform-pricing')
  const { PLATFORM_MARKUP_RATE } = await import('$lib/billing/platform-pricing')
  throwIfProblems(
    await livePreflightProblems({
      estimateUsd: plan.totals.estimatedUsd,
      checks: liveChecks(cli, onModels),
      creditsFor: (usd) => totalCostUsdToCredits(String(usd * (1 + PLATFORM_MARKUP_RATE))),
    }),
  )
  logEval(
    `preflight ok: database ready, OpenRouter key and harness wallet cover the estimate $${plan.totals.estimatedUsd.toFixed(3)} (x margin)`,
  )
  return { plan }
}

async function run(cli: PersonaMemCli): Promise<number> {
  const startedMs = Date.now()
  const crash = resolveCrashSpec(process.env)
  const runId = cli.runId
  if (runId === null)
    throw new Error('[personamem] a real run needs --run-id (the CLI enforces it)')
  const runDir = resolveRunDir({ bench: BENCH, runId })

  let models: { modelChat: string; modelEmbedding: string } | undefined
  const { plan } = await preflight(cli, runDir, (m) => {
    models = m
  })
  if (models === undefined)
    throw new Error('[personamem] preflight did not resolve the platform models')
  logEval(
    `PersonaMem-v2 (--split ${cli.split}, --answer ${cli.answer}${cli.evidenceOnly ? ', SMOKE evidence-only' : ''}${cli.maxHistoryTurns === null ? '' : `, REHEARSAL first ${cli.maxHistoryTurns} turn(s) - not a score`}): ${plan.totals.personas} tenant(s), ` +
      `${plan.totals.captures} capture(s), ${plan.totals.queries} query(ies), chat model ${cli.chatModel}`,
  )

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
    maxHistoryTurns: cli.maxHistoryTurns,
  }
  // --reuse-ingest is checked before this run's directory exists: a mismatch must leave nothing behind
  const reused =
    cli.reuseIngest === null ? null : await verifiedIngest(cli, cli.reuseIngest, plan, true)
  const { paths, meta } = openRun({ runId, identity, resume: cli.resume })

  // --resume: tenants this run already finished ingesting are verified like reused ones
  const ingested =
    reused ?? (cli.resume ? await verifiedIngest(cli, runId, plan, false) : emptyIngest())

  const stagesStored = loadAnswerStages(paths.answerStages)
  const completeStageIds = new Set(
    [...stagesStored].filter(([, s]) => nextStage(s) === 'complete').map(([id]) => id),
  )
  const healed = healLoneVariants(paths.answers, completeStageIds)
  if (healed.length > 0) {
    logEval(
      `answers.jsonl: ${healed.length} lone variant row(s) of a torn write dropped, rebuilt from the stored stages: ${healed.join(', ')}`,
    )
  }
  const existing = parseRows('answers.jsonl', readJsonl(paths.answers), answerRowSchema)

  const command = buildRunCommand(process.argv.slice(2))
  const resumeCommand = buildResumeCommand(process.argv.slice(2))
  const stop = createStopController({
    resumeCommand,
    log: (line) => console.warn(`[eval] ${line}`),
    exit: (code) => process.exit(code),
  })
  const cache = (() => {
    const accounting = createCallAccounting({
      crash,
      kill: killSelf,
      onCrash: ({ phase, n, counters }) => {
        appendProcessCrash(paths.processes, { pid: process.pid, phase, n, calls: counters })
        console.error(`[eval] EVAL_CRASH_AT=${phase}:${n}: sending SIGKILL to this process now`)
      },
    })
    return { accounting, cache: createEvalLlmCache(EVAL_LLM_CACHE_DIR, accounting.observe) }
  })()

  const ctx: RunContext = {
    cli,
    paths,
    billing: { billingUserId: PUBLIC_BENCH_OPERATOR_USER_ID, chatModel: cli.chatModel },
    done: completedQuestionIds(existing),
    ingested: ingested.records,
    families: ingested.families,
    ingestProgress: loadIngestProgress(paths.ingestProgress),
    stages: stagesStored,
    accounting: cache.accounting,
    stop,
    counters: {
      ingest: { skipped: 0, reenriched: 0, queued: 0 },
      answers: { alreadyComplete: 0, stagesReused: 0, answeredNow: 0 },
    },
  }
  ctx.counters.answers.alreadyComplete = ctx.done.size
  logEval(
    `run ${runId}: ${paths.dir} (${ctx.done.size} question(s) already answered; relevance floor ${cli.relevanceFloor}` +
      `${cli.reuseIngest === null ? '' : `; ingest reused from run ${cli.reuseIngest}`}, ${ctx.ingested.size} tenant(s) already ingested)`,
  )
  if (crash !== null) {
    logEval(
      `EVAL_CRASH_AT armed: SIGKILL after the ${crash.n}-th paid call of phase ${crash.phase}`,
    )
  }

  appendProcessStart(paths.processes, {
    pid: process.pid,
    mode: cli.resume ? 'resume' : 'new',
    command,
  })
  const uninstallSignals = stop.install()
  let outcome: ProcessOutcome = 'failed'
  const counters = (): ProcessCounters => ({
    cache: { ...cache.cache.stats },
    calls: cache.accounting.counters(),
    ingest: { ...ctx.counters.ingest },
    answers: { ...ctx.counters.answers },
  })

  try {
    const { stopped } = await withEvalLlmCache(cache.cache, () =>
      runPersonas({
        personas: plan.personas,
        tenantConcurrency: cli.tenantConcurrency,
        failuresPath: paths.failures,
        isAnswered: (id) => ctx.done.has(id),
        isIngested: (tenant) => ctx.ingested.has(tenant),
        ingest: (persona) => {
          if (cli.reuseIngest !== null) {
            throw new Error(
              `[personamem] tenant ${persona.tenantUserId} has no verified ingest record to reuse`,
            )
          }
          return ingestPersona(ctx, persona)
        },
        answer: (persona, question) => answerQuestion(ctx, persona, question),
        stop,
        log: logEval,
      }),
    )

    const rows = parseRows('answers.jsonl', readJsonl(paths.answers), answerRowSchema)
    const distanceByQuestionId = new Map(
      plan.personas.flatMap((p) =>
        p.questions.map((q) => [q.row.questionId, q.row.distance32k] as const),
      ),
    )
    const extra = rows.find((r) => !distanceByQuestionId.has(r.questionId))
    if (extra) {
      throw new Error(
        `[personamem] answers.jsonl holds ${extra.questionId}, which is not in the plan`,
      )
    }
    const answered = new Set(rows.map((r) => r.questionId))
    const status = summarizeRun({
      plannedQuestionIds: [...distanceByQuestionId.keys()],
      answeredQuestionIds: answered,
      ingestedTenants: new Set(ctx.ingested.keys()),
      failures: readFailures(paths.failures),
      stopped,
    })
    const rehearsal = cli.maxHistoryTurns === null ? null : { maxHistoryTurns: cli.maxHistoryTurns }

    if (!status.complete) {
      outcome = stopped ? 'stopped' : 'incomplete'
      writeSummary(
        paths.dir,
        buildIncompleteSummary({
          runId,
          chatModel: cli.chatModel,
          startedAt: meta.startedAt,
          finishedAt: new Date().toISOString(),
          split: cli.split,
          answerMode: cli.answer,
          questions: { planned: distanceByQuestionId.size, answered: answered.size },
          missingQuestions: status.missingQuestions,
          openFailures: status.openFailures,
          stopped,
          resumeCommand,
          rehearsal,
        }),
      )
      const bar = '!'.repeat(78)
      console.error(`\n${bar}`)
      console.error(
        `RUN ${stopped ? 'STOPPED' : 'INCOMPLETE'}: ${answered.size}/${distanceByQuestionId.size} question(s) answered; summary.md is marked incomplete`,
      )
      for (const failure of status.openFailures) {
        console.error(
          `  FAILED ${failure.tenant}${failure.questionId ? ` ${failure.questionId}` : ''} [${failure.phase}]: ${failure.error}`,
        )
      }
      console.error(`Continue (retries failed and unfinished items only):\n  ${resumeCommand}`)
      console.error(`${bar}\n`)
      return status.exitCode
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
        rehearsal,
      }),
    )
    outcome = 'complete'
    logEval(
      `done (${cli.split} split${rehearsal ? ', REHEARSAL - not a score' : ''}): summary in ${paths.dir}`,
    )
    for (const line of formatScoreLines(score, cli.relevanceFloor)) logEval(line)
    return 0
  } finally {
    uninstallSignals()
    const finalCounters = counters()
    appendProcessEnd(paths.processes, { pid: process.pid, outcome, counters: finalCounters })
    logEval(`process outcome: ${outcome}`)
    for (const line of formatCounterLines(finalCounters)) logEval(line)
  }
}

export async function runLive(cli: PersonaMemCli): Promise<void> {
  await runEval(() => run(cli))
}
