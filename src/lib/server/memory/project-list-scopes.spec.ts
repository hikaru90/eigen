import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listProjects } from './project-list'

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
  auditGtdProjectProfiles: vi.fn(async () => ({ demoted: 0 })),
}))

const selectMock = vi.fn()
const selectDistinctMock = vi.fn()

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: selectMock,
    selectDistinct: selectDistinctMock,
  }),
}))

vi.mock('$lib/server/memory/project-eligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-eligibility')>()
  return {
    ...actual,
    countOpenTasksForProjectEntity: vi.fn(async () => 0),
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
})
