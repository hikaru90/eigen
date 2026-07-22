/**
 * Pure IR metrics for the retrieval eval.
 *
 * Inputs:
 *   - `ranked`: ordered list of result ids (rank 1..N).
 *   - `relevance`: map of id -> graded relevance (0..3); ids absent from the map are treated as 0.
 *
 * All functions are deterministic and side-effect free.
 */
export type RelevanceMap = Map<string, number>

export function buildRelevanceMap(entries: Array<{ id: string; grade: number }>): RelevanceMap {
  const map = new Map<string, number>()
  for (const entry of entries) {
    map.set(entry.id, entry.grade)
  }
  return map
}

export function recallAtK(ranked: string[], relevance: RelevanceMap, k: number): number {
  const totalRelevant = countRelevant(relevance)
  if (totalRelevant === 0) return 0
  const top = ranked.slice(0, k)
  let hit = 0
  for (const id of top) {
    if ((relevance.get(id) ?? 0) > 0) hit += 1
  }
  return hit / totalRelevant
}

export function reciprocalRank(ranked: string[], relevance: RelevanceMap): number {
  for (let i = 0; i < ranked.length; i += 1) {
    if ((relevance.get(ranked[i]) ?? 0) > 0) {
      return 1 / (i + 1)
    }
  }
  return 0
}

/**
 * NDCG@k with graded relevance (gain = 2^grade - 1, log2(rank+1) discount).
 * IDCG is computed from the top-k of the sorted full graded set; if no relevant
 * items exist, NDCG is 0.
 */
export function ndcgAtK(ranked: string[], relevance: RelevanceMap, k: number): number {
  const top = ranked.slice(0, k)
  let dcg = 0
  for (let i = 0; i < top.length; i += 1) {
    const grade = relevance.get(top[i]) ?? 0
    if (grade <= 0) continue
    const gain = Math.pow(2, grade) - 1
    const discount = Math.log2(i + 2)
    dcg += gain / discount
  }
  const idealGrades = [...relevance.values()]
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
  if (idealGrades.length === 0) return 0
  let idcg = 0
  for (let i = 0; i < idealGrades.length; i += 1) {
    const gain = Math.pow(2, idealGrades[i]) - 1
    const discount = Math.log2(i + 2)
    idcg += gain / discount
  }
  if (idcg === 0) return 0
  return dcg / idcg
}

function countRelevant(relevance: RelevanceMap): number {
  let n = 0
  for (const grade of relevance.values()) {
    if (grade > 0) n += 1
  }
  return n
}

export type QueryMetrics = {
  recallAt5: number
  recallAt10: number
  ndcgAt10: number
  mrr: number
}

export function computeQueryMetrics(ranked: string[], relevance: RelevanceMap): QueryMetrics {
  return {
    recallAt5: recallAtK(ranked, relevance, 5),
    recallAt10: recallAtK(ranked, relevance, 10),
    ndcgAt10: ndcgAtK(ranked, relevance, 10),
    mrr: reciprocalRank(ranked, relevance),
  }
}

export function meanMetrics(items: QueryMetrics[]): QueryMetrics {
  if (items.length === 0) {
    return { recallAt5: 0, recallAt10: 0, ndcgAt10: 0, mrr: 0 }
  }
  const sum = items.reduce(
    (acc, m) => ({
      recallAt5: acc.recallAt5 + m.recallAt5,
      recallAt10: acc.recallAt10 + m.recallAt10,
      ndcgAt10: acc.ndcgAt10 + m.ndcgAt10,
      mrr: acc.mrr + m.mrr,
    }),
    { recallAt5: 0, recallAt10: 0, ndcgAt10: 0, mrr: 0 },
  )
  return {
    recallAt5: sum.recallAt5 / items.length,
    recallAt10: sum.recallAt10 / items.length,
    ndcgAt10: sum.ndcgAt10 / items.length,
    mrr: sum.mrr / items.length,
  }
}
