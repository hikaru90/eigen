import { appDbAsyncLocal } from '$lib/server/db/context'
import type { AppDatabase } from '$lib/server/db/context'
import { retrievalQualityEvent } from '$lib/server/db/schema'

export const RETRIEVAL_TELEMETRY_VERSION = '1'

export type RetrievalTelemetrySurface = 'api' | 'mcp' | 'compose_answer'

export type RetrievalScoreRow = {
  vectorScore: number
  graphScore: number
}

const EPS = 1e-12

export function semanticShare(row: RetrievalScoreRow): number {
  const denom = row.vectorScore + row.graphScore
  if (denom <= EPS) return 0
  return row.vectorScore / denom
}

export function isGraphOnlyHit(row: RetrievalScoreRow): boolean {
  return row.graphScore > EPS && row.vectorScore <= EPS
}

export function computeRetrievalQualityDiagnostics(
  results: RetrievalScoreRow[],
  weights: { vector: number; graph: number },
  topKRequested: number,
): {
  topKRequested: number
  resultCount: number
  top1SemanticShare: number
  topkMeanSemanticShare: number
  top1PrimaryChannel: 'semantic' | 'graph'
  graphOnlyInTopkCount: number
  weightVector: number
  weightGraph: number
} {
  const resultCount = results.length
  if (resultCount === 0) {
    return {
      topKRequested,
      resultCount: 0,
      top1SemanticShare: 0,
      topkMeanSemanticShare: 0,
      top1PrimaryChannel: 'semantic',
      graphOnlyInTopkCount: 0,
      weightVector: weights.vector,
      weightGraph: weights.graph,
    }
  }
  const top = results[0]
  const s1 = semanticShare(top)
  const mean = results.reduce((acc, r) => acc + semanticShare(r), 0) / resultCount
  const graphOnlyInTopkCount = results.filter(isGraphOnlyHit).length
  return {
    topKRequested,
    resultCount,
    top1SemanticShare: s1,
    topkMeanSemanticShare: mean,
    top1PrimaryChannel: s1 >= 0.5 ? 'semantic' : 'graph',
    graphOnlyInTopkCount,
    weightVector: weights.vector,
    weightGraph: weights.graph,
  }
}

export type RecordRetrievalQualityInput = {
  userId: string
  surface: RetrievalTelemetrySurface
  weights: { vector: number; graph: number }
  topKRequested: number
  results: RetrievalScoreRow[]
}

export async function recordRetrievalQualityEvent(
  db: AppDatabase,
  input: RecordRetrievalQualityInput,
): Promise<void> {
  const diag = computeRetrievalQualityDiagnostics(input.results, input.weights, input.topKRequested)
  await db.insert(retrievalQualityEvent).values({
    userId: input.userId,
    surface: input.surface,
    retrievalVersion: RETRIEVAL_TELEMETRY_VERSION,
    topK: diag.topKRequested,
    weightVector: diag.weightVector,
    weightGraph: diag.weightGraph,
    resultCount: diag.resultCount,
    top1SemanticShare: diag.top1SemanticShare,
    topkMeanSemanticShare: diag.topkMeanSemanticShare,
    top1PrimaryChannel: diag.top1PrimaryChannel,
    graphOnlyInTopkCount: diag.graphOnlyInTopkCount,
  })
}

/**
 * Persists retrieval channel diagnostics when an app DB scope is active.
 * Telemetry failures do not fail the retrieval call (fail-open for availability).
 */
export async function tryRecordRetrievalQualityEvent(
  input: RecordRetrievalQualityInput,
): Promise<void> {
  const db = appDbAsyncLocal.getStore()
  if (!db) return
  try {
    await recordRetrievalQualityEvent(db, input)
  } catch {
    // Intentionally swallow: retrieval must succeed even if diagnostics insert fails.
  }
}
