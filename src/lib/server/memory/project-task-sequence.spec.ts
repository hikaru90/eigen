import { describe, expect, it } from 'vitest'
import {
  computeReorderedThoughtIds,
  selectNextOpenThoughtAfterCompleted,
} from './project-task-sequence'

describe('computeReorderedThoughtIds', () => {
  it('moves thought after another when afterThoughtId is set', () => {
    expect(
      computeReorderedThoughtIds({
        currentOrder: ['a', 'b', 'c', 'd'],
        thoughtId: 'd',
        afterThoughtId: 'a',
      }),
    ).toEqual(['a', 'd', 'b', 'c'])
  })

  it('places thought at explicit 1-based rank', () => {
    expect(
      computeReorderedThoughtIds({
        currentOrder: ['a', 'b', 'c'],
        thoughtId: 'c',
        rank: 1,
      }),
    ).toEqual(['c', 'a', 'b'])
  })

  it('appends when afterThoughtId is null and rank omitted', () => {
    expect(
      computeReorderedThoughtIds({
        currentOrder: ['a', 'b'],
        thoughtId: 'c',
        afterThoughtId: null,
      }),
    ).toEqual(['a', 'b', 'c'])
  })

  it('inserts new thought into empty sequence', () => {
    expect(
      computeReorderedThoughtIds({
        currentOrder: [],
        thoughtId: 'a',
        rank: 1,
      }),
    ).toEqual(['a'])
  })
})

describe('selectNextOpenThoughtAfterCompleted', () => {
  it('returns the next higher-rank open thought', () => {
    expect(
      selectNextOpenThoughtAfterCompleted({
        orderedThoughtIds: ['t1', 't2', 't3'],
        completedThoughtId: 't1',
        openThoughtIds: new Set(['t2', 't3']),
      }),
    ).toBe('t2')
  })

  it('skips completed peers and returns null when none remain', () => {
    expect(
      selectNextOpenThoughtAfterCompleted({
        orderedThoughtIds: ['t1', 't2'],
        completedThoughtId: 't1',
        openThoughtIds: new Set(),
      }),
    ).toBeNull()
  })

  it('returns first open when completed is not in sequence', () => {
    expect(
      selectNextOpenThoughtAfterCompleted({
        orderedThoughtIds: ['t1', 't2'],
        completedThoughtId: 'tx',
        openThoughtIds: new Set(['t1', 't2']),
      }),
    ).toBe('t1')
  })
})
