import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  queue: [] as unknown[][],
  inserted: [] as unknown[],
  conflict: undefined as unknown,
}))

vi.mock('$lib/server/memory/authorship', () => ({
  resolveAuthorSqlCondition: () => 'user-author',
}))
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  and: (...c: unknown[]) => c,
}))
vi.mock('$lib/server/db', () => {
  // every select chain resolves, in call order, to the next queued result set
  const chain = (): unknown => {
    const result = () => Promise.resolve(m.queue.shift() ?? [])
    const proxy: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej),
    }
    for (const k of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy']) proxy[k] = () => proxy
    return proxy
  }
  return {
    getDb: () => ({
      select: () => chain(),
      insert: () => ({
        values: (v: unknown) => {
          m.inserted.push(v)
          return {
            onConflictDoUpdate: (c: unknown) => {
              m.conflict = c
              return Promise.resolve()
            },
          }
        },
      }),
    }),
  }
})

const { loadProjectWindowActivity, computeProjectActivity, recordDigestProjectSnapshots } =
  await import('./daily-digest-projects')

const now = new Date('2026-10-27T08:00:00.000Z')

describe('loadProjectWindowActivity', () => {
  beforeEach(() => {
    m.queue = []
    m.inserted = []
  })

  it('returns per-project counts of new linked thoughts, done tasks, overdue tasks and milestones', async () => {
    m.queue = [
      [{ entityId: 'p1', n: 3 }], // linked thoughts
      [
        { entityId: 'p1', n: 2 },
        { entityId: 'p2', n: 1 },
      ], // tasks done
      [{ entityId: 'p2', n: 4 }], // overdue open tasks
      [
        {
          projectEntityId: 'p1',
          label: 'Beta',
          createdAt: new Date('2026-10-27T01:00:00Z'),
          updatedAt: new Date('2026-10-27T01:00:00Z'),
        },
        {
          projectEntityId: 'p1',
          label: 'Alpha',
          createdAt: new Date('2026-10-01T01:00:00Z'),
          updatedAt: new Date('2026-10-27T02:00:00Z'),
        },
      ],
    ]
    const a = await loadProjectWindowActivity('u1', now)
    expect(a.newThoughts.get('p1')).toBe(3)
    expect(a.tasksDone.get('p2')).toBe(1)
    expect(a.overdueTasks.get('p2')).toBe(4)
    expect(a.milestones.get('p1')).toEqual([
      { label: 'Beta', kind: 'added' },
      { label: 'Alpha', kind: 'changed' },
    ])
  })
})

describe('computeProjectActivity', () => {
  const projects = [
    { entityId: 'p1', label: 'One', nextAction: 'Do X' },
    { entityId: 'p2', label: 'Two', nextAction: null },
    { entityId: 'p3', label: 'Three', nextAction: 'Y' },
    { entityId: 'p4', label: 'Four', nextAction: 'Z' },
    { entityId: 'p5', label: 'Five', nextAction: 'W' },
  ]
  const empty = {
    newThoughts: new Map<string, number>(),
    tasksDone: new Map<string, number>(),
    overdueTasks: new Map<string, number>(),
    milestones: new Map<string, { label: string; kind: 'added' | 'changed' }[]>(),
  }
  const base = {
    projects,
    stalled: [],
    unthreaded: { count: 0, recent: [] },
    snapshot: new Map<string, string | null>(),
  }

  it('ranks top 3 by thoughts + tasks done and drops score 0', () => {
    const r = computeProjectActivity({
      ...base,
      window: {
        ...empty,
        newThoughts: new Map([
          ['p1', 1],
          ['p3', 5],
          ['p4', 2],
          ['p5', 2],
        ]),
        tasksDone: new Map([['p5', 1]]),
      },
    })
    expect(r.mostActive.map((p) => [p.entityId, p.score])).toEqual([
      ['p3', 5],
      ['p5', 3],
      ['p4', 2],
    ])
    expect(r.mostActive[0]).toMatchObject({ newThoughts: 5, tasksDone: 0 })
  })

  it('lists changes only for projects with at least one change, incl. next action vs snapshot', () => {
    const r = computeProjectActivity({
      ...base,
      snapshot: new Map<string, string | null>([
        ['p1', 'Old'], // changed
        ['p3', 'Y'], // unchanged
        ['p2', null], // unchanged
      ]),
      window: {
        ...empty,
        tasksDone: new Map([['p3', 2]]),
        milestones: new Map([['p4', [{ label: 'Launch', kind: 'added' as const }]]]),
      },
    })
    expect(r.changes).toEqual([
      {
        entityId: 'p1',
        label: 'One',
        items: [{ kind: 'next_action_changed', from: 'Old', to: 'Do X' }],
      },
      { entityId: 'p3', label: 'Three', items: [{ kind: 'tasks_done', count: 2 }] },
      { entityId: 'p4', label: 'Four', items: [{ kind: 'milestone_added', label: 'Launch' }] },
    ])
  })

  it('does not report a next-action change for a project without a snapshot (first digest)', () => {
    const r = computeProjectActivity({ ...base, window: empty })
    expect(r.changes).toEqual([])
  })

  it('collects cleanup: stalled, no next action (minus stalled), overdue counts, unthreaded', () => {
    const stalled = [{ entityId: 'p2', label: 'Two', reason: 'no_next_action' }]
    const r = computeProjectActivity({
      ...base,
      stalled,
      unthreaded: { count: 2, recent: [{ thoughtId: 't', snippet: 's' }] },
      projects: [...projects, { entityId: 'p6', label: 'Six', nextAction: null }],
      window: {
        ...empty,
        overdueTasks: new Map([
          ['p1', 3],
          ['gone', 9],
        ]),
      },
    })
    expect(r.needCleanup).toEqual({
      stalled,
      noNextAction: [{ entityId: 'p6', label: 'Six' }],
      overdueTasks: [{ entityId: 'p1', label: 'One', count: 3 }],
      unthreaded: { count: 2, recent: [{ thoughtId: 't', snippet: 's' }] },
    })
  })
})

describe('recordDigestProjectSnapshots', () => {
  beforeEach(() => {
    m.inserted = []
  })

  it('upserts one row per active project with its current next action', async () => {
    await recordDigestProjectSnapshots(
      'u1',
      [
        { entityId: 'p1', label: 'One', nextAction: 'Do X' },
        { entityId: 'p2', label: 'Two', nextAction: null },
      ],
      now,
    )
    expect(m.inserted).toEqual([
      [
        { userId: 'u1', projectEntityId: 'p1', nextActionSummary: 'Do X', recordedAt: now },
        { userId: 'u1', projectEntityId: 'p2', nextActionSummary: null, recordedAt: now },
      ],
    ])
    expect(m.conflict).toBeDefined()
  })

  it('writes nothing when there are no projects', async () => {
    await recordDigestProjectSnapshots('u1', [], now)
    expect(m.inserted).toEqual([])
  })
})
