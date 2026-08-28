import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectMilestone, projectTaskSequence, thought } from '$lib/server/db/schema'
import { listProjects } from './project-list'

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
  auditGtdProjectProfiles: vi.fn(async () => ({ demoted: 0 })),
}))

const {
  selectMock,
  selectDistinctMock,
  insertMock,
  updateMock,
  deleteMock,
  loadOpenTasksMock,
  countOpenTasksMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  selectDistinctMock: vi.fn(),
  // Write handles: reads must never persist task-sequence rows.
  insertMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  loadOpenTasksMock: vi.fn(async () => [] as Array<{ thoughtId: string; createdAt: Date }>),
  countOpenTasksMock: vi.fn(async () => 0),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: selectMock,
    selectDistinct: selectDistinctMock,
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

vi.mock('$lib/server/memory/project-timeline', () => ({}))

type CapturedWhere = unknown[]
const whereCalls: CapturedWhere[] = []

function projectRowsChain(rows: unknown[]) {
  const where = vi.fn(() => {
    whereCalls.push([])
    return rows
  })
  return {
    from: vi.fn(() => ({ where })),
  }
}

function rowsLike(rows: unknown[]) {
  // Awaitable + chainable: callers may await directly or append .orderBy / .limit.
  return Object.assign(Promise.resolve(rows), {
    orderBy: vi.fn(async () => rows),
    limit: vi.fn(async () => rows),
  })
}

function emptyChain(rows: unknown[] = []) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => rowsLike(rows)),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => rowsLike(rows)),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => rowsLike(rows)),
        })),
      })),
    })),
  }
}

/** Routes selects to fixtures by table so task-waterfall reads can be asserted. */
function tableAwareChain(options: {
  projectRows: unknown[]
  sequencedRows?: Array<{ thoughtId: string; rank: number }>
}) {
  return {
    from: (table: unknown) => {
      if (table === projectTaskSequence) {
        return { where: () => ({ orderBy: async () => options.sequencedRows ?? [] }) }
      }
      if (table === projectMilestone) {
        return { where: () => ({ orderBy: async () => [] }) }
      }
      if (table === thought) {
        return {
          where: () => ({
            limit: async () => [
              {
                normalizedText: 'Task',
                normalizedTextEncrypted: null,
                metadata: {},
                metadataEncrypted: null,
              },
            ],
          }),
        }
      }
      return { where: async () => options.projectRows }
    },
  }
}

describe('listProjects scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    whereCalls.length = 0
    selectMock.mockReset()
    selectDistinctMock.mockReset()
  })

  it('prefilters to entityIds when given (item-join / detail callers)', async () => {
    selectMock.mockImplementation(() => {
      const chain = emptyChain([])
      // First select call = project row lookup; capture its where args.
      chain.from = vi.fn(() => ({
        where: vi.fn(() => {
          whereCalls.push(['entityIds'])
          return []
        }),
      }))
      return chain
    })

    const result = await listProjects('u1', { kind: 'all' }, ['p1', 'p2'])

    expect(result).toEqual([])
    expect(whereCalls.length).toBe(1)
  })

  it('returns [] without a DB call for an empty entityIds prefilter', async () => {
    const result = await listProjects('u1', { kind: 'all' }, [])
    expect(result).toEqual([])
    expect(selectMock).not.toHaveBeenCalled()
  })

  it('scope=all keeps agent-authored capture projects (no human-link filter)', async () => {
    selectMock.mockImplementation(() => emptyChain([]))

    await listProjects('u1', { kind: 'all' })

    // No human-linked preselect query runs for 'all'.
    expect(selectDistinctMock).not.toHaveBeenCalled()
  })

  it('scope=user consults human-linked project ids for capture-source rows', async () => {
    const projectRows = [
      {
        entityId: 'manual-1',
        label: 'Manual',
        status: 'active',
        source: 'manual',
        nextActionThoughtId: null,
        targetDate: null,
      },
      {
        entityId: 'agent-capture-1',
        label: 'Agent capture',
        status: 'active',
        source: 'capture',
        nextActionThoughtId: null,
        targetDate: null,
      },
    ]

    let selectCall = 0
    selectMock.mockImplementation(() => {
      selectCall += 1
      if (selectCall === 1) return projectRowsChain(projectRows)
      // task-sequence / milestones queries for visible rows
      return emptyChain([])
    })
    // human-linked ids query: only the capture-sourced agent project survives the filter
    selectDistinctMock.mockImplementation(() => emptyChain([{ entityId: 'agent-capture-1' }]))

    const projects = await listProjects('u1', { kind: 'user' })

    expect(projects.map((p) => p.entityId).sort()).toEqual(['agent-capture-1', 'manual-1'])
  })

  it('scope=authorLayer keeps author-layer projects even without human links', async () => {
    const projectRows = [
      {
        entityId: 'agent-created-1',
        label: 'Agent created',
        status: 'active',
        source: 'capture',
        nextActionThoughtId: null,
        targetDate: null,
      },
    ]

    let selectCall = 0
    selectMock.mockImplementation(() => {
      selectCall += 1
      if (selectCall === 1) return projectRowsChain(projectRows)
      return emptyChain([])
    })
    // Linked-thought query returns nothing — project must still survive.
    selectDistinctMock.mockImplementation(() => emptyChain([]))

    const projects = await listProjects('u1', {
      kind: 'authorLayer',
      author: 'agent',
      authorLayerKey: 'apikey:key-1',
    })

    expect(projects.map((p) => p.entityId)).toEqual(['agent-created-1'])
  })

  it('lists unsequenced open tasks alongside sequenced ones without persisting ranks', async () => {
    const projectRows = [
      {
        entityId: 'p1',
        label: 'Ship beta',
        status: 'active',
        source: 'manual',
        nextActionThoughtId: null,
        targetDate: null,
      },
    ]
    selectMock.mockImplementation(() =>
      tableAwareChain({
        projectRows,
        sequencedRows: [{ thoughtId: 't-sequenced', rank: 1 }],
      }),
    )
    loadOpenTasksMock.mockResolvedValue([
      { thoughtId: 't-sequenced', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { thoughtId: 't-unsequenced', createdAt: new Date('2026-02-01T00:00:00.000Z') },
    ])
    countOpenTasksMock.mockResolvedValue(2)

    const projects = await listProjects('u1', { kind: 'all' })

    expect(projects[0]?.tasks.map((task) => [task.thoughtId, task.rank])).toEqual([
      ['t-sequenced', 1],
      ['t-unsequenced', 2],
    ])
    // Unique itemIds keep the keyed {#each} in the projects waterfall collision-free.
    expect(new Set(projects[0]?.tasks.map((task) => task.itemId)).size).toBe(2)
    expect(projects[0]?.openTaskCount).toBe(2)
    expect(insertMock).not.toHaveBeenCalled()
    expect(updateMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
  })
})
