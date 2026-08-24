import type { GraphScalePoint, GraphScaleReport } from './types'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveGraphScaleReportPaths } from './progress-report'

export function graphScaleReportToCsv(report: GraphScaleReport): string {
  const header = [
    'n_thoughts',
    'entities',
    'edges',
    'communities',
    'projects',
    'seed_wall_ms',
    'capture_usd',
    'capture_credits',
    'capture_wall_ms',
    'qa_usd_total',
    'qa_usd_per_query',
    'qa_p95_ms',
    'consolidation_usd',
    'consolidation_credits',
    'consolidation_wall_ms',
    'communities_summarized',
  ].join(',')

  const rows = report.points.map((point) => graphScalePointToCsvRow(point))
  return [header, ...rows].join('\n') + '\n'
}

function graphScalePointToCsvRow(point: GraphScalePoint): string {
  const cells = [
    point.nThoughts,
    point.graph.entities,
    point.graph.edges,
    point.graph.communities,
    point.graph.projects,
    point.seedWallMs,
    point.captureProbe?.usd ?? '',
    point.captureProbe?.credits ?? '',
    point.captureProbe?.wallMs ?? '',
    point.qaFixedSet?.usdTotal ?? '',
    point.qaFixedSet?.usdPerQuery ?? '',
    point.qaFixedSet?.p95Ms ?? '',
    point.consolidation?.usd ?? '',
    point.consolidation?.credits ?? '',
    point.consolidation?.wallMs ?? '',
    point.consolidation?.communitiesSummarized ?? '',
  ]
  return cells.map((c) => String(c)).join(',')
}

export function writeGraphScaleReport(
  report: GraphScaleReport,
  outputPath: string,
  options?: { jsonPath?: string; csvPath?: string },
): void {
  const paths = resolveGraphScaleReportPaths(outputPath)
  const jsonPath = options?.jsonPath ?? paths.jsonPath
  const csvPath = options?.csvPath ?? paths.csvPath
  mkdirSync(dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(csvPath, graphScaleReportToCsv(report), 'utf8')
}
