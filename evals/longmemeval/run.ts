/**
 * LongMemEval × Eigen — ingest haystack sessions as thoughts, answer via composeAnswer,
 * write LongMemEval hypothesis JSONL, optionally run evaluate_qa.py.
 */
import 'dotenv/config'
import type { LongMemEvalHypothesis, LongMemEvalInstance, LongMemEvalRunCli } from './types'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { insertEvalUserRow, deleteEvalUserRow } from '$lib/eval/store'
import { processCaptureEnrichQueue } from '$lib/server/capture/enrich-queued-thought'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { composeAnswer } from '$lib/server/qa/compose-answer'
import { logEval, runEval, withEvalDb } from '../harness/eval-context'
import {
  waitForThoughtEnrichmentComplete,
  type ThoughtEnrichmentTarget,
} from '../harness/wait-enrichment'
import { parseLongMemEvalCli } from './cli'
import { ensureLongMemEvalOperatorReady, LONGMEMEVAL_OPERATOR_USER_ID } from './ensure-operator'
import {
  corpusUserIdForQuestion,
  instanceToCaptureItems,
  parseLongMemEvalSessionDate,
} from './format-session'
import { loadLongMemEvalDataset } from './load-dataset'
import { assertScoringReady, preflightLongMemEvalScoring, runLongMemEvalScoring } from './scoring'

function loadExistingHypothesisIds(outputPath: string): Set<string> {
  if (!existsSync(outputPath)) return new Set()
  const ids = new Set<string>()
  for (const line of readFileSync(outputPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const row = JSON.parse(trimmed) as LongMemEvalHypothesis
    if (row.question_id) ids.add(row.question_id)
  }
  return ids
}

async function ensureOperatorUser(): Promise<void> {
  await ensureLongMemEvalOperatorReady()
}

async function resetCorpusUser(corpusUserId: string): Promise<void> {
  try {
    await deleteEvalUserRow(corpusUserId)
  } catch {
    // first run — user may not exist
  }
  await insertEvalUserRow(corpusUserId, `LongMemEval corpus ${corpusUserId}`)
}

async function runInstance(
  instance: LongMemEvalInstance,
  granularity: LongMemEvalRunCli['granularity'],
): Promise<string> {
  const corpusUserId = corpusUserIdForQuestion(instance.question_id)
  await resetCorpusUser(corpusUserId)

  const captureItems = instanceToCaptureItems(instance, granularity)
  logEval(
    `${instance.question_id}: ingesting ${captureItems.length} session(s) into ${corpusUserId}`,
  )

  const billing = { billingUserId: LONGMEMEVAL_OPERATOR_USER_ID }

  const thoughtIds = await withEvalDb(
    corpusUserId,
    async () => {
      const ids: string[] = []
      for (const item of captureItems) {
        const queued = await queueCapture(corpusUserId, item.rawText, {
          source: 'eval',
          skipWorker: true,
          capturedAt: item.capturedAt,
        })
        ids.push(queued.thoughtId)
      }
      await processCaptureEnrichQueue(corpusUserId)
      return ids
    },
    billing,
  )

  const targets: ThoughtEnrichmentTarget[] = await withEvalDb(
    corpusUserId,
    async (db) => {
      const { thought } = await import('$lib/server/db/schema')
      const { inArray } = await import('drizzle-orm')
      const rows = await db
        .select({ id: thought.id, normalizedText: thought.normalizedText })
        .from(thought)
        .where(inArray(thought.id, thoughtIds))
      return rows.map((r) => ({ id: r.id, normalizedText: r.normalizedText }))
    },
    billing,
  )

  await withEvalDb(
    corpusUserId,
    async (db) => {
      await waitForThoughtEnrichmentComplete({
        db,
        userId: corpusUserId,
        targets,
        withEvalDbOptions: billing,
      })
    },
    billing,
  )

  logEval(`${instance.question_id}: answering via composeAnswer`)
  const referenceTime = parseLongMemEvalSessionDate(instance.question_date)
  const composed = await withEvalDb(
    corpusUserId,
    () =>
      composeAnswer({
        userId: corpusUserId,
        question: instance.question,
        referenceTime,
      }),
    billing,
  )

  return composed.answer
}

function ensureScoringReady(cli: LongMemEvalRunCli): void {
  if (!cli.runEval) return
  const preflight = preflightLongMemEvalScoring()
  assertScoringReady(preflight, cli.evalMetricModel)
  logEval(`scoring preflight ok (python=${preflight.python}, judge script=${preflight.evalScript})`)
}

async function main(): Promise<void> {
  const cli = parseLongMemEvalCli(process.argv.slice(2))
  ensureScoringReady(cli)

  if (cli.scoreOnly) {
    logEval(`score-only: hyp=${cli.outputPath}, ref=${cli.datasetPath}`)
    runLongMemEvalScoring({
      evalMetricModel: cli.evalMetricModel,
      outputPath: cli.outputPath,
      datasetPath: cli.datasetPath,
    })
    return
  }

  await ensureOperatorUser()

  const dataset = loadLongMemEvalDataset(cli.datasetPath)
  const slice = dataset.slice(cli.offset, cli.limit !== null ? cli.offset + cli.limit : undefined)

  mkdirSync(dirname(cli.outputPath), { recursive: true })
  const skipIds = cli.resume ? loadExistingHypothesisIds(cli.outputPath) : new Set<string>()

  logEval(
    `LongMemEval: ${slice.length} instance(s), output=${cli.outputPath}, granularity=${cli.granularity}`,
  )

  for (const instance of slice) {
    if (skipIds.has(instance.question_id)) {
      logEval(`${instance.question_id}: skipped (resume)`)
      continue
    }

    const hypothesis = await runInstance(instance, cli.granularity)
    const row: LongMemEvalHypothesis = {
      question_id: instance.question_id,
      hypothesis,
    }
    appendFileSync(cli.outputPath, `${JSON.stringify(row)}\n`)
    logEval(`${instance.question_id}: hypothesis written`)
  }

  if (cli.runEval) {
    logEval(`running evaluate_qa.py (model=${cli.evalMetricModel})`)
    runLongMemEvalScoring({
      evalMetricModel: cli.evalMetricModel,
      outputPath: cli.outputPath,
      datasetPath: cli.datasetPath,
    })
  }
}

void runEval(main)
