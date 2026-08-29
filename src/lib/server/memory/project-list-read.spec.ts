import { describe, expect, it, vi } from 'vitest'
import { projectMilestone, projectTaskSequence, thought } from '$lib/server/db/schema'
import { listProjectsForUser } from './project-list'

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
  auditGtdProjectProfiles: vi.fn(async () => ({ demoted: 0 })),
}))

const { selectMock, insertMock, updateMock, deleteMock, loadOpenTasksMock, countOpenTasksMock } =
  vi.hoisted(() => ({
    selectMock: vi.fn(),
    // Write handles: project reads must never touch them (project_task_sequence
    // is only written by explicit ordering calls, never on read).
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    loadOpenTasksMock: vi.fn(async () => [] as Array<{ thoughtId: string; createdAt: Date }>),
    countOpenTasksMock: vi.fn(async () => 0),
  }))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: selectMock,
    selectDistinct: selectMock,
    insert: insertMock,
    update: updateMock,
    delete: deleteMock,
  }),
}))

vi.mock('$lib/server/memory/project-eligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-eligibility')>()
  return {
    ...actual,
    countOpenTasksForProjectEntity: countOpenTasksMock,
    loadOpenTaskThoughtsForProjectEntity: loadOpenTasksMock,
  }
})

function emptyWhereChain(rows: unknown[] = []) {
  const whereResult = Object.assign(Promise.resolve(rows), {
    orderBy: vi.fn(async () => rows),
    limit: vi.fn(async () => rows),
  })
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => whereResult),
      orderBy: vi.fn(async () => rows),
      innerJoin: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    })),
  }
}

/** Pull bound parameter values (drizzle `Param`s) out of a `where(...)` argument. */
function boundValues(args: unknown[]): string[] {
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if ('queryChunks' in record) {
      visit(record.queryChunks)
      return
    }
    if (typeof record.value === 'string' && 'encoder' in record) out.push(record.value)
  }
  visit(args)
  return out
}

type ThoughtFixture = { normalizedText: string | null; metadata?: Record<string, unknown> }

/**
 * Routes every select to a fixture by table so read paths can be asserted
 * without relying on call order.
 */
function mockProjectReads(options: {
  projectRows: unknown[]
  sequencedRows?: Array<{ thoughtId: string; rank: number }>
  milestones?: unknown[]
  thoughts?: Record<string, ThoughtFixture>
}) {
  selectMock.mockImplementation(() => ({
    from: (table: unknown) => {
      if (table === projectTaskSequence) {
        return { where: () => ({ orderBy: async () => options.sequencedRows ?? [] }) }
      }
      if (table === projectMilestone) {
        return { where: () => ({ orderBy: async () => options.milestones ?? [] }) }
      }
      if (table === thought) {
        return {
          where: (...args: unknown[]) => ({
            limit: async () => {
              const thoughtId = boundValues(args).find((value) => value !== 'u1')
              const fixture = thoughtId ? options.thoughts?.[thoughtId] : undefined
              if (!fixture) return []
              return [
                {
                  normalizedText: fixture.normalizedText,
                  normalizedTextEncrypted: null,
                  metadata: fixture.metadata ?? {},
                  metadataEncrypted: null,
                },
              ]
            },
          }),
        }
      }
      return { where: async () => options.projectRows }
    },
  }))
}

const PROJECT_ROW = {
  entityId: 'p1',
  label: 'Ship beta',
  status: 'active',
  source: 'manual',
  nextActionThoughtId: null,
  targetDate: null,
}

describe('listProjectsForUser', () => {
  it('does not run audit on read', async () => {
    selectMock.mockImplementation(() => emptyWhereChain([]))

    await listProjectsForUser('u1', { authorScope: 'all' })

    const { auditGtdProjectProfiles } = await import('$lib/server/memory/judge-gtd-project')
    expect(auditGtdProjectProfiles).not.toHaveBeenCalled()
  })

  it('keeps manual projects when authorScope is user even without linked human thoughts', async () => {
    const projectRows = [
      {
        entityId: 'manual-1',
        label: 'My project',
        status: 'active',
        source: 'manual',
        nextActionThoughtId: null,
        targetDate: null,
      },
      {
        entityId: 'agent-1',
        label: 'Agent project',
        status: 'active',
        source: 'capture',
        nextActionThoughtId: null,
        targetDate: null,
      },
    ]

    let selectCall = 0
    selectMock.mockImplementation(() => {
      selectCall += 1
      if (selectCall === 1) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(async () => projectRows),
          })),
        }
      }
      // human-linked ids + sequence/milestones queries
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(async () => []),
            limit: vi.fn(async () => []),
          })),
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => []),
          })),
          orderBy: vi.fn(async () => []),
        })),
      }
    })

    const projects = await listProjectsForUser('u1', { authorScope: 'user' })

    expect(projects).toHaveLength(1)
    expect(projects[0]?.entityId).toBe('manual-1')
    expect(projects[0]).toMatchObject({
      targetDate: null,
      tasks: [],
      milestones: [],
    })
    expect(JSON.stringify(projects)).not.toContain('embedding')
  })

  it('appends unsequenced open task thoughts after the sequenced ranks', async () => {
    mockProjectReads({
      projectRows: [PROJECT_ROW],
      sequencedRows: [
        { thoughtId: 't1', rank: 1 },
        { thoughtId: 't3', rank: 5 },
      ],
      thoughts: {
        t1: { normalizedText: 'First' },
        t2: { normalizedText: 'Second' },
        t3: { normalizedText: 'Third' },
        t4: { normalizedText: 'Fourth' },
      },
    })
    // The open-task loader returns rows ordered createdAt ASC (t1 < t2 < t3 < t4).
    loadOpenTasksMock.mockResolvedValue([
      { thoughtId: 't1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { thoughtId: 't2', createdAt: new Date('2026-01-15T00:00:00.000Z') },
      { thoughtId: 't3', createdAt: new Date('2026-02-01T00:00:00.000Z') },
      { thoughtId: 't4', createdAt: new Date('2026-03-01T00:00:00.000Z') },
    ])
    countOpenTasksMock.mockResolvedValue(4)

    const projects = await listProjectsForUser('u1', { authorScope: 'all' })

    const tasks = projects[0]?.tasks ?? []
    expect(tasks.map((task) => [task.thoughtId, task.rank])).toEqual([
      ['t1', 1],
      ['t3', 5],
      ['t2', 6],
      ['t4', 7],
    ])
    expect(tasks.map((task) => task.itemId)).toEqual(['task:t1', 'task:t3', 'task:t2', 'task:t4'])
    // Regression: the waterfall must not be shorter than openTaskCount.
    expect(tasks).toHaveLength(4)
    expect(projects[0]?.openTaskCount).toBe(4)
  })

  it('keeps ranks contiguous when an unsequenced task has no summary text', async () => {
    mockProjectReads({
      projectRows: [PROJECT_ROW],
      sequencedRows: [{ thoughtId: 't3', rank: 1 }],
      thoughts: {
        t1: { normalizedText: 'Untitled open task' },
        t2: { normalizedText: '   ' },
        t3: { normalizedText: 'Sequenced' },
      },
    })
    loadOpenTasksMock.mockResolvedValue([
      { thoughtId: 't1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { thoughtId: 't2', createdAt: new Date('2026-02-01T00:00:00.000Z') },
    ])

    const projects = await listProjectsForUser('u1', { authorScope: 'all' })

    expect(projects[0]?.tasks.map((task) => [task.thoughtId, task.rank])).toEqual([
      ['t3', 1],
      ['t1', 2],
    ])
  })

  it('starts unsequenced ranks at 1 when nothing is sequenced yet', async () => {
    mockProjectReads({
      projectRows: [PROJECT_ROW],
      sequencedRows: [],
      thoughts: {
        t1: { normalizedText: 'Older' },
        t2: { normalizedText: 'Newer' },
      },
    })
    loadOpenTasksMock.mockResolvedValue([
      { thoughtId: 't1', createdAt: new Date('2026-04-01T00:00:00.000Z') },
      { thoughtId: 't2', createdAt: new Date('2026-05-01T00:00:00.000Z') },
    ])

    const projects = await listProjectsForUser('u1', { authorScope: 'all' })

    expect(projects[0]?.tasks.map((task) => [task.thoughtId, task.rank])).toEqual([
      ['t1', 1],
      ['t2', 2],
    ])
  })

  it('never writes project task sequence rows on read', async () => {
    mockProjectReads({
      projectRows: [PROJECT_ROW],
      sequencedRows: [{ thoughtId: 't3', rank: 1 }],
      thoughts: {
        t1: { normalizedText: 'Unsequenced' },
        t3: { normalizedText: 'Sequenced' },
      },
    })
    loadOpenTasksMock.mockResolvedValue([
      { thoughtId: 't1', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { thoughtId: 't3', createdAt: new Date('2026-01-02T00:00:00.000Z') },
    ])

    await listProjectsForUser('u1', { authorScope: 'all' })

    // In-memory ranks only: reading must not persist the appended tasks.
    expect(insertMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
