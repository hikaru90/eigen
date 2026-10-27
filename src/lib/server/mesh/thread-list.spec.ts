import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadThreadList, type ThreadListScope } from './thread-list'

const { loadUnifiedTimelineMock, membershipRowsMock } = vi.hoisted(() => ({
  loadUnifiedTimelineMock: vi.fn(),
  membershipRowsMock: vi.fn(),
}))

/** The membership query is one select-chain; every step returns the chain, groupBy yields the rows. */
vi.mock('$lib/server/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => membershipRowsMock(),
  }
  return { getDb: () => chain }
})
vi.mock('$lib/server/memory/authorship', () => ({ resolveAuthorSqlCondition: () => undefined }))
vi.mock('$lib/server/memory/project-membership', () => ({
  projectMembershipLinkCondition: () => undefined,
}))
vi.mock('$lib/server/memory/timeline-unified', () => ({
  loadUnifiedTimeline: loadUnifiedTimelineMock,
}))
vi.mock('../../../routes/mesh/threads/thread-list', () => ({
  groupItemsByThread: () => ({ byThread: new Map(), loose: [] }),
  threadMeta: () => ({ thoughtCount: 0, lastAddedIso: null }),
}))

const scope: ThreadListScope = { author: undefined, authorLayerKey: null }

const project = (entityId: string, status: 'active' | 'stalled' | 'completed' = 'active') => ({
  entityId,
  label: entityId.toUpperCase(),
  status,
  nextAction: null,
  openTaskCount: 0,
  targetDate: null,
  stalled: null,
})

/** One membership row per thread that has thoughts; threads absent from the map have none. */
function givenThreads(
  projects: ReturnType<typeof project>[],
  lastAdded: Record<string, string>,
): void {
  loadUnifiedTimelineMock.mockResolvedValue({ projects, items: [] })
  membershipRowsMock.mockResolvedValue(
    Object.entries(lastAdded).map(([entityId, iso]) => ({
      entityId,
      thoughtCount: 2,
      lastAdded: new Date(iso),
    })),
  )
}

const ids = async () => (await loadThreadList('u1', scope)).threads.map((thread) => thread.entityId)

describe('loadThreadList ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns threads newest first by their latest added thought, whatever order the projects come in', async () => {
    givenThreads([project('a'), project('b', 'stalled'), project('c', 'completed')], {
      a: '2026-10-01T10:00:00.000Z',
      b: '2026-10-03T10:00:00.000Z',
      c: '2026-10-02T10:00:00.000Z',
    })
    expect(await ids()).toEqual(['b', 'c', 'a'])
  })

  it('puts threads without thoughts after all threads with thoughts, in their original order', async () => {
    givenThreads([project('n1'), project('a'), project('n2'), project('b')], {
      a: '2026-10-01T10:00:00.000Z',
      b: '2026-10-02T10:00:00.000Z',
    })
    const list = await loadThreadList('u1', scope)
    expect(list.threads.map((thread) => thread.entityId)).toEqual(['b', 'a', 'n1', 'n2'])
    expect(list.threads.map((thread) => thread.lastAddedIso)).toEqual([
      '2026-10-02T10:00:00.000Z',
      '2026-10-01T10:00:00.000Z',
      null,
      null,
    ])
  })

  it('keeps the original order between threads whose latest thought has the same time', async () => {
    givenThreads([project('x'), project('y'), project('z'), project('w')], {
      x: '2026-10-01T10:00:00.000Z',
      y: '2026-10-03T10:00:00.000Z',
      z: '2026-10-01T10:00:00.000Z',
      w: '2026-10-03T10:00:00.000Z',
    })
    expect(await ids()).toEqual(['y', 'w', 'x', 'z'])
  })

  it('does not reorder the projects it was given', async () => {
    const projects = [project('a'), project('b')]
    givenThreads(projects, { a: '2026-10-01T10:00:00.000Z', b: '2026-10-02T10:00:00.000Z' })
    expect(await ids()).toEqual(['b', 'a'])
    expect(projects.map((p) => p.entityId)).toEqual(['a', 'b'])
  })
})
