import type { AnswerRow } from './types'

export const DISTANCE_BUCKETS = ['0-8k', '8-16k', '16-24k', '24k+'] as const
export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number]

/** Tokens between the preference snippet and the query (`distance32k`). */
export function distanceBucket(tokens: number): DistanceBucket {
  if (tokens < 8000) return '0-8k'
  if (tokens < 16000) return '8-16k'
  if (tokens < 24000) return '16-24k'
  return '24k+'
}

export type GroupStats = {
  n: number
  eigenCorrect: number
  noMemoryCorrect: number
  eigenAccuracy: number
  noMemoryAccuracy: number
  /** eigen − no-memory accuracy over the same questions. */
  lift: number
  /** Eigen rows whose chooser context is non-empty. In evidence-only runs that is a retrieval hit. */
  evidenceRetrieved: number
  evidenceRetrievedRate: number
  /** Mean number of items in the chooser context of the eigen rows. */
  meanContextSize: number
  /**
   * Full-history runs: questions whose evidence is in the history; of these, the ones whose chooser
   * context holds at least one evidence item, and the share. null: the run carries no history
   * evidence (evidence-only), or (rate) the group has no question with history evidence.
   */
  evidenceQuestions: number | null
  evidenceHit: number | null
  evidenceHitRate: number | null
}

export type Score = {
  questions: number
  overall: GroupStats
  byPrefType: Record<string, GroupStats>
  byUpdated: Record<'true' | 'false', GroupStats>
  byWho: Record<string, GroupStats>
  byDistance: Record<string, GroupStats>
  usd: { eigen: number; noMemory: number; total: number }
}

type Pair = { eigen: AnswerRow; noMemory: AnswerRow }

/** Items Eigen gave the chooser; an eigen row without the list is damaged, never "empty". */
function retrievedItems(eigen: AnswerRow): number {
  if (eigen.retrieved === undefined) {
    throw new Error(`[personamem] eigen row for ${eigen.questionId} has no retrieved list`)
  }
  return eigen.retrieved.length
}

function evidenceStats(
  pairs: readonly Pair[],
): Pick<GroupStats, 'evidenceQuestions' | 'evidenceHit' | 'evidenceHitRate'> {
  const withEvidence = pairs.filter((p) => p.eigen.evidence !== undefined)
  if (withEvidence.length === 0) {
    return { evidenceQuestions: null, evidenceHit: null, evidenceHitRate: null }
  }
  const inHistory = withEvidence.filter((p) => p.eigen.evidence!.inHistory)
  const hit = inHistory.filter((p) => {
    const evidence = p.eigen.evidence!
    return evidence.inHistory && evidence.hit
  }).length
  return {
    evidenceQuestions: inHistory.length,
    evidenceHit: hit,
    evidenceHitRate: inHistory.length === 0 ? null : hit / inHistory.length,
  }
}

function statsFor(pairs: readonly Pair[]): GroupStats {
  const n = pairs.length
  const eigenCorrect = pairs.filter((p) => p.eigen.correct).length
  const noMemoryCorrect = pairs.filter((p) => p.noMemory.correct).length
  const eigenAccuracy = eigenCorrect / n
  const noMemoryAccuracy = noMemoryCorrect / n
  const evidenceRetrieved = pairs.filter((p) => retrievedItems(p.eigen) > 0).length
  return {
    n,
    eigenCorrect,
    noMemoryCorrect,
    eigenAccuracy,
    noMemoryAccuracy,
    lift: eigenAccuracy - noMemoryAccuracy,
    evidenceRetrieved,
    evidenceRetrievedRate: evidenceRetrieved / n,
    meanContextSize: pairs.reduce((sum, p) => sum + retrievedItems(p.eigen), 0) / n,
    ...evidenceStats(pairs),
  }
}

function groupStats<K extends string>(
  pairs: readonly Pair[],
  keyOf: (pair: Pair) => K,
  order?: readonly K[],
): Record<K, GroupStats> {
  const groups = new Map<K, Pair[]>()
  for (const pair of pairs) {
    const key = keyOf(pair)
    const list = groups.get(key)
    if (list) list.push(pair)
    else groups.set(key, [pair])
  }
  const keys = order ? order.filter((k) => groups.has(k)) : [...groups.keys()].sort()
  return Object.fromEntries(keys.map((k) => [k, statsFor(groups.get(k)!)])) as Record<K, GroupStats>
}

/** Either every eigen row carries the history-evidence field (full history) or none does. */
function assertEvidenceConsistent(pairs: readonly Pair[]): void {
  const without = pairs.filter((p) => p.eigen.evidence === undefined)
  if (without.length > 0 && without.length < pairs.length) {
    throw new Error(
      `[personamem] eigen row for ${without[0]!.eigen.questionId} has no evidence field although other rows do; run is damaged`,
    )
  }
  for (const p of pairs) {
    const evidence = p.eigen.evidence
    if (evidence?.inHistory && evidence.hit && evidence.items === 0) {
      throw new Error(
        `[personamem] eigen row for ${p.eigen.questionId} claims an evidence hit with 0 evidence items; run is damaged`,
      )
    }
  }
}

/**
 * Aggregates complete `answers.jsonl` rows: every question needs exactly one `eigen` and one
 * `no-memory` row, and a distance. Anything else throws — a partial run never yields a score.
 */
export function scoreAnswers(
  rows: readonly AnswerRow[],
  distanceByQuestionId: ReadonlyMap<string, number>,
): Score {
  if (rows.length === 0) throw new Error('[personamem] no answer rows to score')

  const partial = new Map<string, Partial<Record<AnswerRow['variant'], AnswerRow>>>()
  for (const row of rows) {
    const entry = partial.get(row.questionId) ?? {}
    if (entry[row.variant]) {
      throw new Error(`[personamem] duplicate ${row.variant} row for ${row.questionId}`)
    }
    entry[row.variant] = row
    partial.set(row.questionId, entry)
  }

  const pairs: Pair[] = []
  for (const [questionId, entry] of partial) {
    if (!entry.eigen || !entry['no-memory']) {
      const missing = entry.eigen ? 'no-memory' : 'eigen'
      throw new Error(`[personamem] ${questionId} has no ${missing} row`)
    }
    if (!distanceByQuestionId.has(questionId)) {
      throw new Error(`[personamem] no distance for ${questionId}`)
    }
    pairs.push({ eigen: entry.eigen, noMemory: entry['no-memory'] })
  }

  assertEvidenceConsistent(pairs)

  const distance = (p: Pair) => distanceBucket(distanceByQuestionId.get(p.eigen.questionId)!)
  const eigenUsd = rows.filter((r) => r.variant === 'eigen').reduce((sum, r) => sum + r.usd, 0)
  const noMemoryUsd = rows
    .filter((r) => r.variant === 'no-memory')
    .reduce((sum, r) => sum + r.usd, 0)

  return {
    questions: pairs.length,
    overall: statsFor(pairs),
    byPrefType: groupStats(pairs, (p) => p.eigen.prefType),
    byUpdated: groupStats(pairs, (p) => (p.eigen.updated ? 'true' : 'false')) as Score['byUpdated'],
    byWho: groupStats(pairs, (p) => p.eigen.who),
    byDistance: groupStats(pairs, distance, DISTANCE_BUCKETS),
    usd: { eigen: eigenUsd, noMemory: noMemoryUsd, total: eigenUsd + noMemoryUsd },
  }
}
