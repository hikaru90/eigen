import { describe, expect, it, vi } from 'vitest'
import {
  computeReorderedThoughtIds,
  loadOpenTaskThoughtIdsForProject,
  selectNextOpenThoughtAfterCompleted,
} from './project-task-sequence'

const { loadOpenTasksMock } = vi.hoisted(() => ({
  loadOpenTasksMock: vi.fn(async () => [] as Array<{ thoughtId: string; createdAt: Date }>),
}))

vi.mock('$lib/server/memory/project-eligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-eligibility')>()
  return {
    ...actual,
    loadOpenTaskThoughtsForProjectEntity: loadOpenTasksMock,
  }
})

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

describe('loadOpenTaskThoughtIdsForProject', () => {
  it('reuses the shared open-task loader (one definition of "open")', async () => {
    loadOpenTasksMock.mockResolvedValue([
      { thoughtId: 't1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { thoughtId: 't2', createdAt: new Date('2026-01-02T00:00:00.000Z') },
    ])

    const open = await loadOpenTaskThoughtIdsForProject('u1', 'p1')

    expect(loadOpenTasksMock).toHaveBeenCalledWith('u1', 'p1')
    expect([...open]).toEqual(['t1', 't2'])
  })
})
