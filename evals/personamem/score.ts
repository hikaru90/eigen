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

function statsFor(pairs: readonly Pair[]): GroupStats {
  const n = pairs.length
  const eigenCorrect = pairs.filter((p) => p.eigen.correct).length
  const noMemoryCorrect = pairs.filter((p) => p.noMemory.correct).length
  const eigenAccuracy = eigenCorrect / n
  const noMemoryAccuracy = noMemoryCorrect / n
  return {
    n,
    eigenCorrect,
    noMemoryCorrect,
    eigenAccuracy,
    noMemoryAccuracy,
    lift: eigenAccuracy - noMemoryAccuracy,
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
