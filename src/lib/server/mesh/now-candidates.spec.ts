import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, listProjectsMock, decryptMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  listProjectsMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: decryptMock }))
vi.mock('$lib/server/memory/project-list', () => ({ listProjectsForUser: listProjectsMock }))

import { loadNowCandidates, NOW_CANDIDATE_LIMIT } from './now-candidates'

type Rows = {
  hidden?: unknown[]
  thoughts?: unknown[]
  membership?: unknown[]
  events?: unknown[]
  skips?: unknown[]
}

type Call = { name: keyof Rows; where?: unknown; limit?: number }

/** Dispatches each select by its field names; every chain records its WHERE and LIMIT. */
function fakeDb(rows: Rows) {
  const calls: Call[] = []
  getDbMock.mockReturnValue({
    select: (fields: Record<string, unknown>) => {
      const name: keyof Rows =
        'total' in fields
          ? 'thoughts'
          : 'projectLabel' in fields
            ? 'membership'
            : 'eventAt' in fields
              ? 'events'
              : 'skipCount' in fields
                ? 'skips'
                : 'hidden'
      const call: Call = { name }
      calls.push(call)
      const chain: Record<string, unknown> = {
        from: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        groupBy: () => chain,
        orderBy: () => chain,
        where: (cond: unknown) => {
          call.where = cond
          return chain
        },
        limit: (n: number) => {
          call.limit = n
          return chain
        },
        then: (resolve: (v: unknown[]) => unknown) => resolve(rows[name] ?? []),
      }
      return chain
    },
  })
  return calls
}

function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = new PgDialect().sqlToQuery(cond as never)
  return { sql: q.sql, params: q.params }
}

function thoughtRow(overrides: Record<string, unknown> = {}) {
  return {
    thoughtId: 't1',
    category: 'task',
    author: 'user',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    normalizedText: 'Call the landlord about the deposit',
    normalizedTextEncrypted: null,
    total: 1,
    ...overrides,
  }
}

function projectItem(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 'p1',
    label: 'Sewer',
    status: 'active',
    nextAction: { thoughtId: 'n1', summary: 'Book the site visit', itemId: 'task:n1' },
    openTaskCount: 4,
    targetDate: '2026-12-01T00:00:00.000Z',
    stalled: null,
    milestones: [
      { id: 'm1', label: 'Permit', targetDate: '2026-11-20T00:00:00.000Z', completedAt: null },
    ],
    tasks: [],
    ...overrides,
  }
}

const NOW = new Date('2026-11-09T09:00:00.000Z')

describe('loadNowCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) => ciphertext)
    listProjectsMock.mockResolvedValue([])
  })

  it('builds thought candidates with author, project, rank, event date and skip count', async () => {
    fakeDb({
      thoughts: [
        thoughtRow({ thoughtId: 't2', createdAt: new Date('2026-10-01T10:00:00.000Z'), total: 2 }),
        thoughtRow({
          thoughtId: 't1',
          author: 'agent',
          normalizedText: null,
          normalizedTextEncrypted: 'cipher:Send the form\nsecond line',
          total: 2,
        }),
      ],
      membership: [
        { thoughtId: 't1', projectEntityId: 'p1', projectLabel: 'Sewer', rank: 3 },
        { thoughtId: 't2', projectEntityId: 'p9', projectLabel: 'Unordered', rank: null },
      ],
      events: [{ thoughtId: 't1', eventAt: new Date('2026-11-12T00:00:00.000Z') }],
      skips: [{ thoughtId: 't2', skipCount: 3 }],
    })
    decryptMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.replace('cipher:', ''),
    )

    const result = await loadNowCandidates('u1', NOW)

    expect(result.candidatesOmitted).toBe(0)
    // oldest first
    expect(result.thoughts.map((t) => t.thoughtId)).toEqual(['t1', 't2'])
    expect(result.thoughts[0]).toEqual({
      thoughtId: 't1',
      category: 'task',
      snippet: 'Send the form',
      author: 'agent',
      createdAt: '2026-09-01T10:00:00.000Z',
      project: { id: 'p1', label: 'Sewer', rank: 3 },
      eventAt: '2026-11-12T00:00:00.000Z',
      skipCount: 0,
    })
    expect(result.thoughts[1]).toMatchObject({
      project: { id: 'p9', label: 'Unordered', rank: null },
      eventAt: null,
      skipCount: 3,
    })
    expect(decryptMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', table: 'thought', column: 'normalized_text' }),
    )
  })

  it('queries open task and goal thoughts of this user only, newest 150 first', async () => {
    const calls = fakeDb({ thoughts: [thoughtRow()] })

    await loadNowCandidates('u1', NOW)

    const call = calls.find((c) => c.name === 'thoughts')!
    const { sql, params } = render(call.where)
    expect(sql).toContain('"thought"."user_id" = $')
    expect(sql).toContain('"thought"."lifecycle_status" = $')
    expect(sql).toContain('"thought"."category" in (')
    expect(params).toEqual(expect.arrayContaining(['u1', 'open', 'task', 'goal']))
    expect(call.limit).toBe(NOW_CANDIDATE_LIMIT)
    expect(NOW_CANDIDATE_LIMIT).toBe(150)
  })

  it('uses the shared membership definition and the user for project links', async () => {
    const calls = fakeDb({ thoughts: [thoughtRow()] })

    await loadNowCandidates('u1', NOW)

    const { sql, params } = render(calls.find((c) => c.name === 'membership')!.where)
    expect(sql).toContain('"thought_entity"."source" in (')
    expect(params).toEqual(expect.arrayContaining(['u1', 'manual', 'project', 't1']))
    expect(sql).toContain('"canonical_entity"."project_status" is not null')
  })

  it('counts skips as this user\'s answered not_now cards for the thoughts', async () => {
    const calls = fakeDb({ thoughts: [thoughtRow()] })

    await loadNowCandidates('u1', NOW)

    const { sql, params } = render(calls.find((c) => c.name === 'skips')!.where)
    expect(sql).toContain('"now_card"."user_id" = $')
    expect(params).toEqual(expect.arrayContaining(['u1', 'answered', 'not_now', 't1']))
  })

  it('excludes thoughts with a hidden_until in the future from the thought query', async () => {
    const calls = fakeDb({
      hidden: [{ thoughtId: 'h1', projectEntityId: null }],
      thoughts: [thoughtRow()],
    })

    await loadNowCandidates('u1', NOW)

    const hidden = render(calls.find((c) => c.name === 'hidden')!.where)
    expect(hidden.sql).toContain('"now_card"."hidden_until" > $')
    expect(hidden.params).toEqual(expect.arrayContaining(['u1', NOW.toISOString()]))
    const thoughts = render(calls.find((c) => c.name === 'thoughts')!.where)
    expect(thoughts.sql).toContain('"thought"."id" not in (')
    expect(thoughts.params).toContain('h1')
  })

  it('excludes hidden projects from the project candidates', async () => {
    fakeDb({ hidden: [{ thoughtId: null, projectEntityId: 'p2' }] })
    listProjectsMock.mockResolvedValue([
      projectItem(),
      projectItem({ entityId: 'p2', label: 'Hidden one' }),
    ])

    const result = await loadNowCandidates('u1', NOW)

    expect(result.projects.map((p) => p.entityId)).toEqual(['p1'])
  })

  it('lists active projects only, with deadline, milestones, next action and stalled reason', async () => {
    fakeDb({})
    listProjectsMock.mockResolvedValue([
      projectItem(),
      projectItem({ entityId: 'p3', label: 'Parked', status: 'someday' }),
      projectItem({
        entityId: 'p4',
        label: 'Stuck',
        nextAction: null,
        openTaskCount: 0,
        targetDate: null,
        milestones: [],
        stalled: { reason: 'no_next_action' },
      }),
    ])

    const result = await loadNowCandidates('u1', NOW)

    expect(listProjectsMock).toHaveBeenCalledWith('u1', { authorScope: 'all' })
    expect(result.projects).toEqual([
      {
        entityId: 'p1',
        label: 'Sewer',
        deadline: '2026-12-01T00:00:00.000Z',
        milestones: [{ label: 'Permit', targetDate: '2026-11-20T00:00:00.000Z', completedAt: null }],
        nextAction: 'Book the site visit',
        openTaskCount: 4,
        stalledReason: null,
      },
      {
        entityId: 'p4',
        label: 'Stuck',
        deadline: null,
        milestones: [],
        nextAction: null,
        openTaskCount: 0,
        stalledReason: 'no_next_action',
      },
    ])
  })

  it('reports how many thoughts the cap left out, never silently', async () => {
    fakeDb({
      thoughts: Array.from({ length: NOW_CANDIDATE_LIMIT }, (_, i) =>
        thoughtRow({ thoughtId: `t${i}`, total: 187 }),
      ),
    })

    const result = await loadNowCandidates('u1', NOW)

    expect(result.thoughts).toHaveLength(NOW_CANDIDATE_LIMIT)
    expect(result.candidatesOmitted).toBe(37)
  })

  it('runs no follow-up queries when there are no open thoughts', async () => {
    const calls = fakeDb({ thoughts: [] })

    const result = await loadNowCandidates('u1', NOW)

    expect(result).toEqual({ thoughts: [], projects: [], candidatesOmitted: 0 })
    expect(calls.map((c) => c.name).sort()).toEqual(['hidden', 'thoughts'])
  })
})
