import { describe, expect, it } from 'vitest'
import { graphRearrangeHadChanges, graphRearrangeSummaryLines } from './graph-rearrange-display'

describe('graphRearrangeSummaryLines', () => {
  it('returns only non-zero change lines', () => {
    expect(
      graphRearrangeSummaryLines({
        pruned: { removed: 2 },
        orphanThoughts: { removed: 0 },
        orphanEntities: { removed: 4 },
        duplicatePruned: { removed: 1 },
        connections: { removed: 0 },
        repaired: { edgesAdded: 3 },
      }),
    ).toEqual([
      { label: 'weak edges pruned', count: 2 },
      { label: 'orphan entities removed', count: 4 },
      { label: 'duplicate-driven edge removed', count: 1 },
      { label: 'relation edges added', count: 3 },
    ])
  })

  it('uses singular labels for count of 1', () => {
    expect(
      graphRearrangeSummaryLines({
        pruned: { removed: 1 },
        repaired: { edgesAdded: 1 },
      }),
    ).toEqual([
      { label: 'weak edge pruned', count: 1 },
      { label: 'relation edge added', count: 1 },
    ])
  })

  it('reports no changes when all counts are zero', () => {
    expect(graphRearrangeHadChanges({})).toBe(false)
    expect(graphRearrangeSummaryLines({})).toEqual([])
  })
})
