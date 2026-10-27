import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rowsResult: vi.fn(),
  linkRowsResult: vi.fn(),
  loadRelatedThoughts: vi.fn(),
  loadCaptureVerdicts: vi.fn(),
}))

/** Two selects: the thought rows (…limit) and the thread links (…orderBy). Every step returns the chain. */
vi.mock('$lib/server/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => Object.assign(Promise.resolve(mocks.linkRowsResult()), chain),
    limit: () => mocks.rowsResult(),
  }
  return { getDb: () => chain }
})
vi.mock('$lib/server/memory/authorship', () => ({ resolveAuthorSqlCondition: () => undefined }))
vi.mock('$lib/server/memory/project-membership', () => ({
  projectMembershipLinkCondition: () => undefined,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: vi.fn() }))
vi.mock('$lib/server/mesh/related-thoughts', () => ({
  loadRelatedThoughts: mocks.loadRelatedThoughts,
}))
vi.mock('$lib/server/capture-review/vote-store', () => ({
  loadCaptureVerdicts: mocks.loadCaptureVerdicts,
}))

import { loadYarnThoughts } from './yarn-list'

function row(id: string) {
  return {
    id,
    normalizedText: `words of ${id}`,
    normalizedTextEncrypted: null,
    category: 'task',
    metadata: {},
    metadataEncrypted: null,
    lifecycleStatus: 'open',
    createdAt: new Date('2026-10-27T09:00:00Z'),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rowsResult.mockResolvedValue([row('a'), row('b'), row('c')])
  mocks.linkRowsResult.mockReturnValue([])
  mocks.loadRelatedThoughts.mockResolvedValue(new Map())
  mocks.loadCaptureVerdicts.mockResolvedValue(new Map())
})

describe('loadYarnThoughts: the vote on each row (shared by Yarn, thread detail and /api/mesh/yarn)', () => {
  it('carries each row’s current verdict: up, down, or null when it was never voted on', async () => {
    mocks.loadCaptureVerdicts.mockResolvedValue(
      new Map([
        ['a', 'up'],
        ['c', 'down'],
      ]),
    )

    const thoughts = await loadYarnThoughts('u1')

    expect(thoughts.map((t) => [t.id, t.verdict])).toEqual([
      ['a', 'up'],
      ['b', null],
      ['c', 'down'],
    ])
  })

  it('asks for the verdicts of exactly the rows it returns, for this user, in one lookup', async () => {
    await loadYarnThoughts('u1')
    expect(mocks.loadCaptureVerdicts).toHaveBeenCalledTimes(1)
    expect(mocks.loadCaptureVerdicts).toHaveBeenCalledWith('u1', ['a', 'b', 'c'])
  })

  it('carries the verdict only: no reason text, no kind, no score', async () => {
    mocks.loadCaptureVerdicts.mockResolvedValue(new Map([['a', 'down']]))
    const [first] = await loadYarnThoughts('u1')
    expect(Object.keys(first).sort()).toEqual(
      [
        'category',
        'createdAtIso',
        'id',
        'isTodo',
        'related',
        'status',
        'text',
        'threadEntityId',
        'threadLabel',
        'verdict',
      ].sort(),
    )
  })

  it('a failed verdict lookup fails the list loudly (no silent rows without votes)', async () => {
    mocks.loadCaptureVerdicts.mockRejectedValue(new Error('db down'))
    await expect(loadYarnThoughts('u1')).rejects.toThrow('db down')
  })

  it('looks up nothing for an empty strand', async () => {
    mocks.rowsResult.mockResolvedValue([])
    await expect(loadYarnThoughts('u1')).resolves.toEqual([])
    expect(mocks.loadCaptureVerdicts).toHaveBeenCalledWith('u1', [])
  })
})
