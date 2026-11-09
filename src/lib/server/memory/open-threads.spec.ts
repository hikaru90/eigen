import { PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  listProjectsForUserMock,
  decryptTenantValueMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  listProjectsForUserMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptTenantValueMock,
}))
vi.mock('$lib/server/memory/project-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/memory/project-list')>()
  return {
    ...actual,
    listProjectsForUser: listProjectsForUserMock,
  }
})

import { loadOpenThreads, snippetForOpenThread } from './open-threads'

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 'p1',
    label: 'Ship',
    status: 'active',
    source: 'manual',
    nextAction: null,
    openTaskCount: 3,
    targetDate: '2026-08-01T00:00:00.000Z',
    stalled: { reason: 'deadline_overdue' },
    tasks: [],
    milestones: [],
    ...overrides,
  }
}

function orphanRow(overrides: Record<string, unknown> = {}) {
  return {
    thoughtId: 't1',
    category: 'task',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    normalizedText: 'Sewer project workflow: build and launch',
    normalizedTextEncrypted: null,
    ...overrides,
  }
}

/**
 * Select fake: the outer thought select (the one with `category`) returns `rows`
 * through select().from().where().orderBy().limit(); the sub-selects are real
 * (connectionless) drizzle builders so their joins build as in production.
 */
function makeSelectChain(rows: unknown[]) {
  const limit = vi.fn(async () => rows)
  const real = drizzle.mock()
  getDbMock.mockReturnValue({
    select: (fields: Record<string, unknown>) =>
      'category' in fields
        ? { from: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }) }
        : real.select(fields as never),
  })
  return { limit }
}

/**
 * Real query builders (no connection) for the sub-selects, a fake only for the
 * outer thought select; returns the rendered WHERE of that outer select.
 */
function captureOrphanWhereSql(): () => { sql: string; params: unknown[] } {
  const real = drizzle.mock()
  let captured: unknown
  getDbMock.mockReturnValue({
    select: (fields: Record<string, unknown>) => {
      if ('category' in fields) {
        return {
          from: () => ({
            where: (cond: unknown) => {
              captured = cond
              return { orderBy: () => ({ limit: async () => [] }) }
            },
          }),
        }
      }
      return real.select(fields as never)
    },
  })
  return () => {
    const q = new PgDialect().sqlToQuery(captured as never)
    return { sql: q.sql, params: q.params }
  }
}

describe('loadOpenThreads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) => ciphertext)
  })

  it('lists only ACTIVE projects whose stalled signal fired, with the reason', async () => {
    listProjectsForUserMock.mockResolvedValue([
      projectRow(),
      projectRow({ entityId: 'p2', label: 'Someday thing', status: 'someday', stalled: { reason: 'no_next_action' } }),
      projectRow({ entityId: 'p3', label: 'Healthy', stalled: null }),
      projectRow({ entityId: 'p4', label: 'No next action', targetDate: null, stalled: { reason: 'no_next_action' } }),
    ])
    makeSelectChain([])

    const view = await loadOpenThreads('u1')

    expect(view.stalledProjects.map((p) => p.label).sort()).toEqual(['No next action', 'Ship'])
    expect(view.stalledProjects[0]).toMatchObject({
      entityId: 'p1',
      stalled: { reason: 'deadline_overdue' },
      openTaskCount: 3,
      targetDate: '2026-08-01T00:00:00.000Z',
    })
  })

  it('maps orphan open task/goal thoughts with decrypted snippet and ISO createdAt (query orders oldest first)', async () => {
    listProjectsForUserMock.mockResolvedValue([])
    const { limit } = makeSelectChain([
      orphanRow({
        thoughtId: 't0',
        category: 'goal',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        normalizedTextEncrypted: 'enc:crypto boom research',
        normalizedText: '',
      }),
      orphanRow(),
    ])
    decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.replace(/^enc:/, ''),
    )

    const view = await loadOpenThreads('u1')

    expect(limit).toHaveBeenCalledWith(50)
    expect(view.orphanThreads).toHaveLength(2)
    expect(view.orphanThreads[0]).toMatchObject({
      thoughtId: 't0',
      category: 'goal',
      createdAt: '2026-08-01T10:00:00.000Z',
      snippet: 'crypto boom research',
    })
    expect(view.orphanThreads[1]).toMatchObject({
      thoughtId: 't1',
      category: 'task',
      snippet: 'Sewer project workflow: build and launch',
    })
    expect(decryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', column: 'normalized_text', ciphertext: 'enc:crypto boom research' }),
    )
  })

  it('a task with project membership is not loose even without a sequence row (NOW-AC18)', async () => {
    listProjectsForUserMock.mockResolvedValue([])
    const rendered = captureOrphanWhereSql()

    await loadOpenThreads('u1')

    const { sql: text, params } = rendered()
    // Sequence rows still exclude a thought...
    expect(text).toMatch(/"thought"\."id" not in \(select "thought_id" from "project_task_sequence"/i)
    // ...and so does membership: thought_entity joined to a project entity.
    expect(text).toMatch(/"thought"\."id" not in \(select "thought_entity"\."thought_id" from "thought_entity"/i)
    expect(text).toMatch(/inner join "canonical_entity"/i)
    expect(text).toMatch(/"canonical_entity"\."project_status" is not null/i)
    // The existing membership definition: manual + project sources, never plain ingest mentions.
    expect(text).toMatch(/"thought_entity"\."source" in \(\$\d+, \$\d+\)/i)
    expect(params).toEqual(expect.arrayContaining(['manual', 'project']))
    expect(params).not.toContain('ingest')
  })

  it('truncates long first lines deterministically', () => {
    const long = 'A'.repeat(300)
    const out = snippetForOpenThread(long)
    expect(out).toHaveLength(160)
    expect(out.endsWith('…')).toBe(true)
    expect(snippetForOpenThread('short')).toBe('short')
    expect(snippetForOpenThread('first\nsecond')).toBe('first')
  })
})
