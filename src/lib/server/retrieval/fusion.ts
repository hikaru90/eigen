export type RankedItem = {
  id: string
  rank: number
}

export function reciprocalRankFusion(rankings: RankedItem[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>()

  for (const ranking of rankings) {
    for (const item of ranking) {
      const current = scores.get(item.id) ?? 0
      scores.set(item.id, current + 1 / (k + item.rank))
    }
  }

  return scores
}
