import { beforeEach, describe, expect, it, vi } from 'vitest'

const selectMock = vi.fn()

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: selectMock,
  }),
}))

vi.mock('$lib/server/memory/project-eligibility', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./project-eligibility')>()
  return {
    ...actual,
    countOpenTasksForProjectEntity: vi.fn(async () => 1),
  }
})

vi.mock('$lib/server/memory/judge-gtd-project', () => ({
  auditGtdProjectProfiles: vi.fn(async () => ({ demoted: 0 })),
}))

import {
  listEligibleProjectsForAssignment,
  loadEligibleGtdProjects,
} from './project-list'

function whereChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(async () => rows),
    })),
  }
}

describe('listEligibleProjectsForAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes both active and someday projects (same catalog for dialog + ingest)', async () => {
    const rows = [
      {
        entityId: 'active-1',
        label: 'Ship Eigen',
        status: 'active',
        source: 'manual',
      },
      {
        entityId: 'someday-1',
        label: 'Learn cello',
        status: 'someday',
        source: 'manual',
      },
    ]
    selectMock.mockImplementation(() => whereChain(rows))

    const eligible = await listEligibleProjectsForAssignment('u1')
    expect(eligible.map((p) => p.entityId).sort()).toEqual(['active-1', 'someday-1'])

    const ingest = await loadEligibleGtdProjects('u1')
    expect(ingest.map((p) => p.entityId).sort()).toEqual(eligible.map((p) => p.entityId).sort())
  })

  it('excludes completed and dismissed projects from both assignment paths', async () => {
    selectMock.mockImplementation(() =>
      whereChain([
        {
          entityId: 'active-1',
          label: 'Keep',
          status: 'active',
          source: 'manual',
        },
      ]),
    )

    const eligible = await listEligibleProjectsForAssignment('u1')
    expect(eligible.map((p) => p.entityId)).toEqual(['active-1'])
  })
})
