import 'dotenv/config'
import type { GraphScalePoint, GraphScaleReport } from './types'
import { randomUUID } from 'node:crypto'
import {
  initialGraphScaleLiveState,
  publishGraphScaleLiveState,
  type GraphScaleLiveState,
} from '$lib/server/e2e/graph-scale-live-state'
import { runEval, withEvalDb } from '../harness/eval-context'
import { parseGraphScaleCli } from './cli'
import { GraphScaleConsoleProgress } from './console-progress'
import { ensureGraphScaleOperatorReady, GRAPH_SCALE_OPERATOR_USER_ID } from './ensure-operator'
import { collectGraphScaleMetrics } from './graph-metrics'
import { formatGraphScaleIngestLogLine } from './ingest-result'
import { GRAPH_SCALE_CORPUS_PATH } from './load-corpus'
import { measureGraphScaleCaptureProbe } from './measure-capture'
import { measureGraphScaleConsolidation } from './measure-consolidation'
import { measureGraphScaleQaSet } from './measure-qa'
import { GRAPH_SCALE_QA_QUERIES } from './measure-qa'
import { GraphScaleProgressWriter, resolveGraphScaleReportPaths } from './progress-report'
import { writeGraphScaleReport } from './report'
import { graphScaleCorpusUserId } from './seed-corpus'
import { seedGraphScaleCorpus } from './seed-corpus-runner'

function emitProgress(
  consoleProgress: GraphScaleConsoleProgress,
  fileProgress: GraphScaleProgressWriter,
  label: string,
  opts?: Parameters<GraphScaleConsoleProgress['report']>[1],
): void {
  const snap = consoleProgress.report(label, opts)
  fileProgress.tick(snap)
}

async function main(): Promise<void> {
  process.env.GRAPH_SCALE_QUIET = '1'
  if (!process.env.DB_POOL_MAX?.trim()) {
    process.env.DB_POOL_MAX = '16'
  }
  process.env.LLM_MIN_REQUEST_INTERVAL_MS = '1000'
  if (!process.env.CAPTURE_ENRICH_CONCURRENCY?.trim()) {
    process.env.CAPTURE_ENRICH_CONCURRENCY = '1'
  }
  if (!process.env.EVAL_SEED_CONCURRENCY?.trim()) {
    process.env.EVAL_SEED_CONCURRENCY = '2'
  }
  if (!process.env.LLM_REQUEST_TIMEOUT_MS?.trim()) {
    process.env.LLM_REQUEST_TIMEOUT_MS = '180000'
  }

  const cli = parseGraphScaleCli(process.argv.slice(2))
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const reportPaths = resolveGraphScaleReportPaths(cli.outputPath)
  const fileProgress = new GraphScaleProgressWriter(reportPaths.progressPath)
  const consoleProgress = new GraphScaleConsoleProgress({
    sizes: cli.sizes,
    tracks: cli.tracks,
  })
  const points: GraphScalePoint[] = []

  let live: GraphScaleLiveState = initialGraphScaleLiveState({ runId, label: 'starting' })
  const touchLive = (patch: Partial<GraphScaleLiveState> & { label: string }) => {
    live = { ...live, ...patch, updatedAt: new Date().toISOString() }
    publishGraphScaleLiveState(live)
  }
  touchLive({ label: 'starting' })

  fileProgress.step({
    step: 'run_started',
    runId,
    operatorUserId: GRAPH_SCALE_OPERATOR_USER_ID,
    sizes: cli.sizes,
    tracks: [...cli.tracks],
    corpusSource: GRAPH_SCALE_CORPUS_PATH,
    progressPath: fileProgress.path,
    jsonPath: reportPaths.jsonPath,
    csvPath: reportPaths.csvPath,
  })
  emitProgress(consoleProgress, fileProgress, 'starting')

  const stopHeartbeat = setInterval(() => {
    const ageSec = Math.round((Date.now() - Date.parse(live.updatedAt)) / 1000)
    console.info(
      `[graph-scale] heartbeat · ${live.label} · enrich ${live.seedEnriched}/${live.seedEnrichTotal}` +
        (live.enrichPhase ? ` · ${live.enrichPhase}` : '') +
        ` · live age ${ageSec}s`,
    )
    touchLive({ label: live.label })
  }, 15_000)
  stopHeartbeat.unref?.()

  try {
    await ensureGraphScaleOperatorReady()
    emitProgress(consoleProgress, fileProgress, 'operator ready')

    for (let sizeIndex = 0; sizeIndex < cli.sizes.length; sizeIndex++) {
      const n = cli.sizes[sizeIndex]
      const corpusUserId = graphScaleCorpusUserId(runId, n)
      touchLive({
        status: 'seeding',
        n,
        corpusUserId,
        seedEnrichTotal: n,
        label: `N=${n} seed (${sizeIndex + 1}/${cli.sizes.length})`,
      })
      emitProgress(
        consoleProgress,
        fileProgress,
        `N=${n} seed (${sizeIndex + 1}/${cli.sizes.length})`,
      )

      const seeded = await seedGraphScaleCorpus({
        runId,
        n,
        billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
        seedConcurrency: cli.seedConcurrency,
        onSeedQueued: (queued, total) => {
          touchLive({
            seedQueued: queued,
            seedEnrichTotal: total,
            label: `N=${n} seed queue ${queued}/${total}`,
          })
          emitProgress(consoleProgress, fileProgress, `N=${n} seed queue ${queued}/${total}`, {
            seedQueued: queued,
            seedTotal: total,
          })
        },
        onSeedEnrich: (enriched, total) => {
          touchLive({
            seedEnriched: enriched,
            seedEnrichTotal: total,
            label: `N=${n} seed enrich ${enriched}/${total}`,
          })
          emitProgress(consoleProgress, fileProgress, `N=${n} seed enrich ${enriched}/${total}`, {
            seedEnriched: enriched,
            seedEnrichTotal: total,
            force: enriched === 0 || enriched === total,
          })
        },
        onLiveMetrics: (graph) => {
          touchLive({ graph, label: live.label })
        },
        onEnrichPhase: (phase) => {
          console.info(`[graph-scale] ${phase}`)
          touchLive({ enrichPhase: phase, label: live.label })
        },
        onIngestResult: (result) => {
          fileProgress.step({
            step: 'ingest_result',
            n: result.n,
            index: result.index,
            total: result.total,
            thoughtId: result.thoughtId,
            ok: result.ok,
            enriched: result.enriched,
            entityCount: result.entityCount,
            hasEmbedding: result.hasEmbedding,
            ...(result.error ? { error: result.error } : {}),
          })
          touchLive({
            lastIngest: {
              thoughtId: result.thoughtId,
              index: result.index,
              ok: result.ok,
              enriched: result.enriched,
              entityCount: result.entityCount,
              hasEmbedding: result.hasEmbedding,
              ...(result.error ? { error: result.error } : {}),
            },
            label: `N=${n} ingest ${result.index}/${result.total} ${result.ok ? 'ok' : result.error ? 'FAIL' : 'weak'}`,
          })
          console.info(
            formatGraphScaleIngestLogLine({
              index: result.index,
              total: result.total,
              ok: result.ok,
              enriched: result.enriched,
              entityCount: result.entityCount,
              hasEmbedding: result.hasEmbedding,
              error: result.error,
            }),
          )
        },
      })

      emitProgress(consoleProgress, fileProgress, `N=${n} seed done`, { completeSeed: true })

      const graph = await withEvalDb(
        seeded.userId,
        (db) => collectGraphScaleMetrics(seeded.userId, db),
        { billingUserId: GRAPH_SCALE_OPERATOR_USER_ID },
      )

      touchLive({
        status: 'measuring',
        graph,
        label: `N=${n} measuring`,
      })

      const point: GraphScalePoint = {
        nThoughts: n,
        graph,
        captureProbe: null,
        qaFixedSet: null,
        consolidation: null,
        seedWallMs: seeded.wallMs,
      }

      if (cli.tracks.has('capture')) {
        const groupId = randomUUID()
        emitProgress(consoleProgress, fileProgress, `N=${n} capture probe`)
        point.captureProbe = await measureGraphScaleCaptureProbe({
          userId: seeded.userId,
          billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
          groupId,
        })
        emitProgress(consoleProgress, fileProgress, `N=${n} capture done`, { bump: 'capture' })
      }

      if (cli.tracks.has('qa')) {
        emitProgress(consoleProgress, fileProgress, `N=${n} Q&A 0/${GRAPH_SCALE_QA_QUERIES.length}`)
        point.qaFixedSet = await measureGraphScaleQaSet({
          userId: seeded.userId,
          billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
          onQueryComplete: (query) => {
            emitProgress(
              consoleProgress,
              fileProgress,
              `N=${n} Q&A ${query.questionIndex}/${query.questionCount}`,
              { bump: 'qaQuery' },
            )
          },
        })
      }

      if (cli.tracks.has('consolidation')) {
        const groupId = randomUUID()
        emitProgress(consoleProgress, fileProgress, `N=${n} consolidation`)
        point.consolidation = await measureGraphScaleConsolidation({
          userId: seeded.userId,
          billingUserId: GRAPH_SCALE_OPERATOR_USER_ID,
          groupId,
        })
        emitProgress(consoleProgress, fileProgress, `N=${n} consolidation done`, {
          bump: 'consolidation',
        })
      }

      points.push(point)
      fileProgress.step({ step: 'point_completed', n, point })
    }

    const report: GraphScaleReport = {
      runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      operatorUserId: GRAPH_SCALE_OPERATOR_USER_ID,
      sizes: cli.sizes,
      tracks: [...cli.tracks],
      points,
    }

    writeGraphScaleReport(report, cli.outputPath, {
      jsonPath: reportPaths.jsonPath,
      csvPath: reportPaths.csvPath,
    })
    fileProgress.step({ step: 'run_finished', report })
    touchLive({ status: 'finished', label: 'done', graph: live.graph })
    consoleProgress.finish(`[graph-scale] 100% · done · report ${reportPaths.jsonPath}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    touchLive({ status: 'failed', error: message, label: `failed: ${message}` })
    fileProgress.step({ step: 'run_failed', error: message, partialPoints: points })
    consoleProgress.finish(`[graph-scale] failed · ${message}`)
    throw err
  } finally {
    clearInterval(stopHeartbeat)
  }
}

void runEval(main)
