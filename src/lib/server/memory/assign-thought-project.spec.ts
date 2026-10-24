import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assignThoughtToProject, unassignThoughtFromProject } from './assign-thought-project'

const {
  getDbMock,
  linkThoughtToProjectMock,
  clearNextActionIfCompletedMock,
  resolveProjectIdentityMock,
  maybePromoteHubToGtdProjectMock,
  promoteHubEntityTypeMock,
  ensureProjectMock,
  loadProjectMembershipEntityIdsMock,
  deleteMentionEdgeMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  linkThoughtToProjectMock: vi.fn(async () => undefined),
  clearNextActionIfCompletedMock: vi.fn(async () => undefined),
  resolveProjectIdentityMock: vi.fn(async () => ({
    entityId: 'hub-1',
    canonicalLabel: 'EigenMesh',
    hubEntityType: 'organization',
    isGtdProject: false,
    shouldCreateHub: true,
    mergeEntityIds: [],
  })),
  maybePromoteHubToGtdProjectMock: vi.fn(async () => false),
  promoteHubEntityTypeMock: vi.fn(async () => undefined),
  ensureProjectMock: vi.fn(async () => undefined),
  loadProjectMembershipEntityIdsMock: vi.fn(async (): Promise<string[]> => []),
  deleteMentionEdgeMock: vi.fn(async () => undefined),
}))

vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))

vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: linkThoughtToProjectMock,
  clearNextActionIfCompleted: clearNextActionIfCompletedMock,
}))

vi.mock('$lib/server/memory/project-membership', () => ({
  loadProjectMembershipEntityIds: loadProjectMembershipEntityIdsMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  deleteMentionEdge: deleteMentionEdgeMock,
}))

vi.mock('$lib/server/memory/resolve-project-identity', () => ({
  resolveProjectIdentity: resolveProjectIdentityMock,
}))

vi.mock('$lib/server/memory/maybe-promote-gtd-project', () => ({
  promoteEntityToProject: maybePromoteHubToGtdProjectMock,
  maybePromoteHubToGtdProject: maybePromoteHubToGtdProjectMock,
}))

vi.mock('$lib/server/memory/project-entity', () => ({
  promoteHubEntityType: promoteHubEntityTypeMock,
}))

vi.mock('$lib/server/memory/project-eligibility', () => ({
  ensureProject: ensureProjectMock,
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
  beforeEach(() => {
    vi.clearAllMocks()
    resolveProjectIdentityMock.mockResolvedValue({
      entityId: 'hub-1',
      canonicalLabel: 'EigenMesh',
      hubEntityType: 'organization',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
  })

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

  it('creates a manual project for a new label without LLM judge veto', async () => {
    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => makeSelectChain([{ nextActionThoughtId: null }])),
    }))

    const result = await assignThoughtToProject('u1', 't1', { projectLabel: 'EigenMesh' })

    expect(promoteHubEntityTypeMock).toHaveBeenCalledWith('u1', 'hub-1', 'EigenMesh')
    expect(ensureProjectMock).toHaveBeenCalledWith('u1', 'hub-1', 'active', 'manual')
    expect(result).toMatchObject({
      projectEntityId: 'hub-1',
      projectLabel: 'EigenMesh',
      eligible: true,
      isGtdProject: true,
      created: true,
    })
  })

  it('still creates the manual project when the LLM identity judge says not a project', async () => {
    resolveProjectIdentityMock.mockResolvedValueOnce({
      entityId: 'hub-2',
      canonicalLabel: 'Roasted Garlic',
      hubEntityType: 'ingredient',
      isGtdProject: false,
      shouldCreateHub: true,
      mergeEntityIds: [],
    })
    getDbMock.mockImplementation(() => ({
      select: vi.fn(() => makeSelectChain([{ nextActionThoughtId: null }])),
    }))

    const result = await assignThoughtToProject('u1', 't1', { projectLabel: 'Roasted Garlic' })

    expect(maybePromoteHubToGtdProjectMock).not.toHaveBeenCalled()
    expect(ensureProjectMock).toHaveBeenCalledWith('u1', 'hub-2', 'active', 'manual')
    expect(result.isGtdProject).toBe(true)
  })
})

describe('unassignThoughtFromProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProjectMembershipEntityIdsMock.mockResolvedValue([])
  })

  function dbWithDelete() {
    const where = vi.fn(async () => undefined)
    const deleteFn = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ delete: deleteFn })
    return { deleteFn, where }
  }

  it('removes every membership row and its graph edge — the thought is loose again', async () => {
    loadProjectMembershipEntityIdsMock.mockResolvedValue(['p1', 'p2'])
    const { deleteFn, where } = dbWithDelete()

    const result = await unassignThoughtFromProject('u1', 't1')

    expect(result).toEqual({ removedEntityIds: ['p1', 'p2'] })
    expect(deleteFn).toHaveBeenCalledTimes(1)
    expect(deleteMentionEdgeMock).toHaveBeenCalledTimes(2)
    expect(deleteMentionEdgeMock).toHaveBeenCalledWith({ userId: 'u1', thoughtId: 't1', entityId: 'p1' })
    expect(deleteMentionEdgeMock).toHaveBeenCalledWith({ userId: 'u1', thoughtId: 't1', entityId: 'p2' })
    expect(where).toHaveBeenCalledTimes(1)
    // the next action moves on without the removed thought
    expect(clearNextActionIfCompletedMock).toHaveBeenCalledWith('u1', 't1')
  })

  it('a thought on no thread stays untouched — no delete, no graph call, no next-action churn', async () => {
    const { deleteFn } = dbWithDelete()

    const result = await unassignThoughtFromProject('u1', 't1')

    expect(result).toEqual({ removedEntityIds: [] })
    expect(deleteFn).not.toHaveBeenCalled()
    expect(deleteMentionEdgeMock).not.toHaveBeenCalled()
    expect(clearNextActionIfCompletedMock).not.toHaveBeenCalled()
  })

  it('rejects an empty thoughtId at the boundary', async () => {
    await expect(unassignThoughtFromProject('u1', '   ')).rejects.toThrow(/thoughtId/)
  })
})
