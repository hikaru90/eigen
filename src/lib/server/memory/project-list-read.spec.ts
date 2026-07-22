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

describe('listProjectsForUser', () => {
  it('does not run audit on read', async () => {
    const chain = {
      from: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    }
    selectMock.mockReturnValue(chain)

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
      },
      {
        entityId: 'agent-1',
        label: 'Agent project',
        status: 'active',
        source: 'capture',
        nextActionThoughtId: null,
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
      return {
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => []),
          })),
        })),
      }
    })

    const projects = await listProjectsForUser('u1', { authorScope: 'user' })

    expect(projects).toHaveLength(1)
    expect(projects[0]?.entityId).toBe('manual-1')
  })
})
