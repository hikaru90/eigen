import { beforeEach, describe, expect, it, vi } from 'vitest'

const getDbMock = vi.hoisted(() => vi.fn())

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: vi.fn(async () => '{}'),
}))

import { listTemporalEventsForUser, absoluteRangeCondition, usesAbsoluteDateFilter } from './temporal-event-list'
import type { AbsoluteDateRange } from '$lib/memory/timeline-date-range'

function makeSelectChain(whereSpy: ReturnType<typeof vi.fn>, rows: unknown[] = []) {
  const limit = vi.fn(async () => rows)
  const orderBy = vi.fn(() => ({ limit }))
  const where = whereSpy.mockImplementation(() => ({
    orderBy,
    limit,
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
      return Promise.resolve(rows).then(onFulfilled, onRejected)
    },
  }))
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({ where })),
      where,
    })),
  }
}

describe('listTemporalEventsForUser author filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockListSelects(spies: {
    eventWhere: ReturnType<typeof vi.fn>
    taskWhere: ReturnType<typeof vi.fn>
    projectWhere?: ReturnType<typeof vi.fn>
  }) {
    let selectCall = 0
    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return makeSelectChain(spies.eventWhere, [])
        }
        if (selectCall === 2) {
          const limit = vi.fn(async () => [])
          const orderBy = vi.fn(() => ({ limit }))
          const where = spies.taskWhere.mockImplementation(() => ({
            orderBy,
            limit,
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (error: unknown) => unknown,
            ) {
              return Promise.resolve([]).then(onFulfilled, onRejected)
            },
          }))
          return {
            from: vi.fn(() => ({
              leftJoin: vi.fn(() => ({ where })),
              where,
            })),
          }
        }
        return makeSelectChain(spies.projectWhere ?? vi.fn(), [])
      }),
    }))
    return () => selectCall
  }

  it('queries temporal events and task thoughts when author is user', async () => {
    const eventWhere = vi.fn()
    const taskWhere = vi.fn()
    mockListSelects({ eventWhere, taskWhere })

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'open',
      includeTasks: true,
      author: 'user',
    })

    expect(eventWhere).toHaveBeenCalled()
    expect(taskWhere).toHaveBeenCalled()
  })

  it('queries without author constraint when author is omitted', async () => {
    const eventWhere = vi.fn()
    const taskWhere = vi.fn()
    mockListSelects({ eventWhere, taskWhere })

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'open',
      includeTasks: true,
    })

    expect(eventWhere).toHaveBeenCalled()
    expect(taskWhere).toHaveBeenCalled()
  })

  it('queries with authorLayerKey when provided', async () => {
    const eventWhere = vi.fn()
    const taskWhere = vi.fn()
    mockListSelects({ eventWhere, taskWhere })

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'open',
      includeTasks: true,
      authorLayerKey: 'apikey:key-1',
    })

    expect(eventWhere).toHaveBeenCalled()
    expect(taskWhere).toHaveBeenCalled()
  })
})

describe('absoluteRangeCondition', () => {
  it('returns undefined when both from and to are null (unbounded)', () => {
    const range: AbsoluteDateRange = { from: null, to: null, includeUndated: true }
    expect(absoluteRangeCondition(range)).toBeUndefined()
  })

  it('returns a SQL fragment when from or to is set', () => {
    const range: AbsoluteDateRange = {
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
    }
    expect(absoluteRangeCondition(range)).toBeDefined()
  })
})

describe('usesAbsoluteDateFilter', () => {
  it('is true for All time null/null so we never fall back to legacy relevant', () => {
    expect(usesAbsoluteDateFilter({ userId: 'u1', from: null, to: null })).toBe(true)
  })

  it('is true when only one bound is set', () => {
    expect(
      usesAbsoluteDateFilter({ userId: 'u1', from: '2026-07-14T00:00:00.000Z', to: null }),
    ).toBe(true)
  })

  it('is false when from/to keys are omitted (legacy range enum callers)', () => {
    expect(usesAbsoluteDateFilter({ userId: 'u1', range: 'relevant' })).toBe(false)
  })
})

describe('listTemporalEventsForUser absolute from/to', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts from/to/includeUndated on the query object', async () => {
    const eventWhereSpy = vi.fn()
    let selectCall = 0

    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return makeSelectChain(eventWhereSpy, [])
        }
        return makeSelectChain(vi.fn(), [])
      }),
    }))

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'all',
      includeTasks: false,
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: false,
    })

    expect(eventWhereSpy).toHaveBeenCalled()
  })

  it('accepts All time null/null without throwing (unbounded absolute mode)', async () => {
    const eventWhereSpy = vi.fn()
    let selectCall = 0

    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return makeSelectChain(eventWhereSpy, [])
        }
        return makeSelectChain(vi.fn(), [])
      }),
    }))

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'all',
      includeTasks: false,
      from: null,
      to: null,
      alwaysIncludeOpen: true,
    })

    expect(eventWhereSpy).toHaveBeenCalled()
  })

  it('accepts alwaysIncludeOpen with absolute from/to without throwing', async () => {
    const eventWhereSpy = vi.fn()
    let selectCall = 0

    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return makeSelectChain(eventWhereSpy, [])
        }
        return makeSelectChain(vi.fn(), [])
      }),
    }))

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'all',
      includeTasks: false,
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      alwaysIncludeOpen: true,
    })

    expect(eventWhereSpy).toHaveBeenCalled()
  })

  it('merges tasks without an unbounded temporal_event thoughtId preload', async () => {
    const eventWhereSpy = vi.fn()
    const taskWhereSpy = vi.fn()
    const projectWhereSpy = vi.fn()
    let selectCall = 0
    const leftJoins: unknown[] = []

    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => {
        selectCall += 1
        if (selectCall === 1) {
          return makeSelectChain(eventWhereSpy, [])
        }
        if (selectCall === 2) {
          // Task thoughts: leftJoin temporal_event + isNull — no prior thoughtId dump
          const limit = vi.fn(async () => [])
          const orderBy = vi.fn(() => ({ limit }))
          const where = taskWhereSpy.mockImplementation(() => ({
            orderBy,
            limit,
            then(
              onFulfilled: (value: unknown) => unknown,
              onRejected?: (error: unknown) => unknown,
            ) {
              return Promise.resolve([]).then(onFulfilled, onRejected)
            },
          }))
          return {
            from: vi.fn(() => ({
              leftJoin: vi.fn((...args: unknown[]) => {
                leftJoins.push(args)
                return { where }
              }),
              where,
            })),
          }
        }
        return makeSelectChain(projectWhereSpy, [])
      }),
    }))

    await listTemporalEventsForUser({
      userId: 'u1',
      status: 'open',
      includeTasks: true,
      from: '2026-07-14T00:00:00.000Z',
      to: '2026-07-20T23:59:59.999Z',
      includeUndated: true,
    })

    // Events + tasks anti-join; project-links select is skipped when thoughtIds empty
    expect(selectCall).toBe(2)
    expect(leftJoins.length).toBe(1)
    expect(taskWhereSpy).toHaveBeenCalled()
  })
})
