/**
 * LongMemEval × Eigen — ingest haystack sessions as thoughts, answer via composeAnswer,
 * write LongMemEval hypothesis JSONL, optionally run evaluate_qa.py.
 */
import 'dotenv/config'
import type { LongMemEvalHypothesis, LongMemEvalInstance, LongMemEvalRunCli } from './types'
import { LONGMEMEVAL_OPERATOR_USER_ID } from '$lib/server/auth/harness-billing'
import { PLATFORM_CHAT_MODEL } from '$lib/server/billing/platform-llm'
import { resolveCaptureEnrichConcurrency } from '$lib/server/capture/enrich-queue-drain'
import { composeAnswer } from '$lib/server/qa/compose-answer'
import { logEval, runEval, withEvalDb } from '../harness/eval-context'
import { ensurePublicBenchOperator } from '../public-bench/ensure-operator'
import { ingestTenant } from '../public-bench/ingest-tenant'
import { appendJsonl, readJsonlIds } from '../public-bench/run-output'
import { parseLongMemEvalCli } from './cli'
import {
  corpusUserIdForQuestion,
  instanceToCaptureItems,
  parseLongMemEvalSessionDate,
} from './format-session'
import { loadLongMemEvalDataset } from './load-dataset'
import { assertScoringReady, preflightLongMemEvalScoring, runLongMemEvalScoring } from './scoring'

async function runInstance(
  instance: LongMemEvalInstance,
  cli: LongMemEvalRunCli,
  enrichConcurrency: number,
): Promise<string> {
  const corpusUserId = corpusUserIdForQuestion(instance.question_id)
  const captureItems = instanceToCaptureItems(instance, cli.granularity)

  await ingestTenant({
    tenantUserId: corpusUserId,
    billingUserId: LONGMEMEVAL_OPERATOR_USER_ID,
    chatModel: PLATFORM_CHAT_MODEL,
    items: captureItems,
    enrichConcurrency,
    reset: true,
  })

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
    { billingUserId: LONGMEMEVAL_OPERATOR_USER_ID, chatModel: PLATFORM_CHAT_MODEL },
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

  await ensurePublicBenchOperator({
    operatorUserId: LONGMEMEVAL_OPERATOR_USER_ID,
    displayName: 'LongMemEval Runner',
    chatModel: PLATFORM_CHAT_MODEL,
  })
  const enrichConcurrency = resolveCaptureEnrichConcurrency(cli.enrichConcurrency ?? undefined)

  const dataset = loadLongMemEvalDataset(cli.datasetPath)
  const slice = dataset.slice(cli.offset, cli.limit !== null ? cli.offset + cli.limit : undefined)

  const skipIds = cli.resume ? readJsonlIds(cli.outputPath, 'question_id') : new Set<string>()

  logEval(
    `LongMemEval: ${slice.length} instance(s), output=${cli.outputPath}, granularity=${cli.granularity}`,
  )

  for (const instance of slice) {
    if (skipIds.has(instance.question_id)) {
      logEval(`${instance.question_id}: skipped (resume)`)
      continue
    }

    const hypothesis = await runInstance(instance, cli, enrichConcurrency)
    const row: LongMemEvalHypothesis = {
      question_id: instance.question_id,
      hypothesis,
    }
    appendJsonl(cli.outputPath, row)
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

await runEval(main)
