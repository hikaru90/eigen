import { describe, expect, it, vi } from 'vitest'
import { listProjectsForUser } from './project-list'

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
  auditGtdProjectProfiles: vi.fn(async () => ({ demoted: 0 })),
}))

const selectMock = vi.fn()

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: selectMock,
    selectDistinct: selectMock,
  }),
}))

vi.mock('$lib/server/memory/project-eligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-eligibility')>()
  return {
    ...actual,
    countOpenTasksForProjectEntity: vi.fn(async () => 0),
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
})
