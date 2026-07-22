import { describe, expect, it, vi } from 'vitest'
import { assignThoughtToProject } from './assign-thought-project'

const {
  getDbMock,
  linkThoughtToProjectMock,
  resolveProjectIdentityMock,
  maybePromoteHubToGtdProjectMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  linkThoughtToProjectMock: vi.fn(async () => undefined),
  resolveProjectIdentityMock: vi.fn(async () => ({
    entityId: 'hub-1',
    canonicalLabel: 'EigenMesh',
    hubEntityType: 'organization',
    isGtdProject: false,
    shouldCreateHub: true,
    mergeEntityIds: [],
  })),
  maybePromoteHubToGtdProjectMock: vi.fn(async () => false),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkThoughtToProjectMock,
}))

vi.mock('$lib/server/memory/resolve-project-identity', () => ({
  resolveProjectIdentity: resolveProjectIdentityMock,
}))

vi.mock('$lib/server/memory/maybe-promote-gtd-project', () => ({
  promoteEntityToProject: maybePromoteHubToGtdProjectMock,
  maybePromoteHubToGtdProject: maybePromoteHubToGtdProjectMock,
}))

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  }
  return chain
}

describe('assignThoughtToProject', () => {
  it('links thought to existing eligible project entity', async () => {
    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => makeSelectChain([{ id: 'p1', label: 'Website' }])),
    }))
    maybePromoteHubToGtdProjectMock.mockResolvedValueOnce(true)

    const result = await assignThoughtToProject('u1', 't1', { projectEntityId: 'p1' })
    expect(result).toMatchObject({
      projectEntityId: 'p1',
      projectLabel: 'Website',
      eligible: true,
      isGtdProject: true,
    })
    expect(linkThoughtToProjectMock).toHaveBeenCalledWith('u1', 'p1', 't1', 'manual')
  })

  it('uses LLM promotion path for new label', async () => {
    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => makeSelectChain([])),
    }))

    const result = await assignThoughtToProject('u1', 't1', { projectLabel: 'EigenMesh' })
    expect(maybePromoteHubToGtdProjectMock).toHaveBeenCalledWith({
      userId: 'u1',
      entityId: 'hub-1',
      source: 'manual',
      forceJudge: true,
    })
    expect(result.isGtdProject).toBe(false)
  })
})
