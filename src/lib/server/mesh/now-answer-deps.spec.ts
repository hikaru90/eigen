import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getDb: vi.fn(),
  setLifecycle: vi.fn(),
  setCategory: vi.fn(),
  capture: vi.fn(),
  link: vi.fn(),
  designate: vi.fn(),
  updateStatus: vi.fn(),
  order: vi.fn(),
  replaceSequence: vi.fn(),
  loadNow: vi.fn(),
  timezone: vi.fn(),
  deleteEdge: vi.fn(),
  upsertEdge: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: m.getDb }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: m.encrypt,
  decryptTenantValue: m.decrypt,
}))
vi.mock('$lib/server/capture/service', () => ({ captureThought: m.capture }))
vi.mock('$lib/server/memory/lifecycle', () => ({ setThoughtLifecycleStatus: m.setLifecycle }))
vi.mock('$lib/server/memory/thought-category', () => ({ setThoughtCategory: m.setCategory }))
vi.mock('$lib/server/memory/project-next-action', () => ({
  linkThoughtToProject: m.link,
  designateNextAction: m.designate,
}))
vi.mock('$lib/server/memory/project-list', () => ({ updateProjectStatus: m.updateStatus }))
vi.mock('$lib/server/memory/project-task-sequence', () => ({
  orderTaskInProject: m.order,
  replaceProjectTaskSequence: m.replaceSequence,
  loadOrderedThoughtIdsForProject: vi.fn(async () => []),
}))
vi.mock('$lib/server/memory/user-timezone', () => ({ getUserPreferredTimezone: m.timezone }))
vi.mock('$lib/server/graph/age', () => ({
  deleteMentionEdge: m.deleteEdge,
  upsertMentionEdge: m.upsertEdge,
}))
vi.mock('./now-store', () => ({ loadNowCard: m.loadNow }))

import {
  buildNowAnswerDeps,
  buildNowUndoDeps,
  claimNowCard,
  claimNowUndo,
  releaseNowCard,
} from './now-answer-deps'

const sql = (cond: unknown) => new PgDialect().sqlToQuery(cond as never)
const NOW = new Date('2026-11-09T10:00:00.000Z')

/** A db whose update().set().where() records the call; where() is also awaitable and has returning(). */
function updateDb(returned: unknown[] = [{ id: 'c1' }]) {
  const rec: { set?: unknown; where?: unknown } = {}
  const db = {
    update: () => ({
      set: (values: unknown) => {
        rec.set = values
        return {
          where: (cond: unknown) => {
            rec.where = cond
            const p = Promise.resolve(undefined)
            return Object.assign(p, { returning: async () => returned })
          },
        }
      },
    }),
  }
  m.getDb.mockReturnValue(db)
  return rec
}

/** A db whose select() chains resolve to the next scripted result. */
function selectDb(results: unknown[][]) {
  let i = 0
  const chain = (): Record<string, unknown> => {
    const rows = results[i++] ?? []
    const c: Record<string, unknown> = {
      from: () => c,
      leftJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: async () => rows,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
    }
    return c
  }
  m.getDb.mockReturnValue({ select: chain })
}

beforeEach(() => vi.clearAllMocks())

describe('claim, release and undo claim', () => {
  it('claim only takes this user\'s pending card and writes answer and time', async () => {
    const rec = updateDb([{ id: 'c1' }])
    await expect(claimNowCard('u1', 'c1', 'done', NOW)).resolves.toBe(true)
    expect(rec.set).toEqual({ status: 'answered', answer: 'done', answeredAt: NOW })
    const q = sql(rec.where)
    expect(q.sql).toContain('"now_card"."user_id" = $')
    expect(q.sql).toContain('"now_card"."id" = $')
    expect(q.sql).toContain('"now_card"."status" = $')
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'c1', 'pending']))
  })

  it('claim reports false when no row was pending', async () => {
    updateDb([])
    await expect(claimNowCard('u1', 'c1', 'done', NOW)).resolves.toBe(false)
  })

  it('release puts the card back to pending and clears answer, time, undo state and hiding', async () => {
    const rec = updateDb()
    await releaseNowCard('u1', 'c1')
    expect(rec.set).toEqual({
      status: 'pending',
      answer: null,
      answeredAt: null,
      undoStateEncrypted: null,
      hiddenUntil: null,
    })
    expect(sql(rec.where).params).toEqual(expect.arrayContaining(['u1', 'c1']))
  })

  it('undo claim only takes an answered card of this user and clears it like a release', async () => {
    const rec = updateDb([{ id: 'c1' }])
    await expect(claimNowUndo('u1', 'c1')).resolves.toBe(true)
    expect(rec.set).toMatchObject({ status: 'pending', answer: null, undoStateEncrypted: null })
    expect(sql(rec.where).params).toEqual(expect.arrayContaining(['u1', 'c1', 'answered']))
    updateDb([])
    await expect(claimNowUndo('u1', 'c1')).resolves.toBe(false)
  })
})

describe('buildNowAnswerDeps wires the existing writes', () => {
  const deps = () => buildNowAnswerDeps('u1', NOW)

  it('lifecycle, category, link, order, designate, status and capture go through the existing functions', async () => {
    m.setLifecycle.mockResolvedValue({ ok: true })
    m.setCategory.mockResolvedValue({ ok: true, category: 'note' })
    m.capture.mockResolvedValue({ id: 'new-thought' })
    const d = deps()

    await d.setLifecycle('t1', 'completed')
    expect(m.setLifecycle).toHaveBeenCalledWith('u1', 't1', 'completed')
    await d.setCategory('t1', 'note')
    expect(m.setCategory).toHaveBeenCalledWith('u1', 't1', 'note')
    await expect(d.captureStep('Book it')).resolves.toBe('new-thought')
    expect(m.capture).toHaveBeenCalledWith('u1', 'Book it', { source: 'now' })
    await d.linkToProject('p1', 't1')
    expect(m.link).toHaveBeenCalledWith('u1', 'p1', 't1', 'manual')
    await d.appendToProjectOrder('p1', 't1')
    expect(m.order).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      thoughtId: 't1',
      afterThoughtId: null,
    })
    await d.designateNextAction('p1', 't1')
    expect(m.designate).toHaveBeenCalledWith('u1', 'p1', 't1')
    await d.setProjectStatus('p1', 'completed')
    expect(m.updateStatus).toHaveBeenCalledWith('u1', 'p1', 'completed')
  })

  it('a lifecycle or category write that reports failure throws, so the claim is released', async () => {
    m.setLifecycle.mockResolvedValue({ ok: false, reason: 'not_found' })
    m.setCategory.mockResolvedValue({ ok: false, reason: 'unknown_category' })
    const d = deps()
    await expect(d.setLifecycle('t1', 'archived')).rejects.toThrow(/not found/)
    await expect(d.setCategory('t1', 'zzz')).rejects.toThrow(/unknown_category/)
  })

  it('timeZone and loadNext use the user and the request time', async () => {
    m.timezone.mockResolvedValue('Europe/Berlin')
    m.loadNow.mockResolvedValue({ state: 'clear' })
    const d = deps()
    await expect(d.timeZone()).resolves.toBe('Europe/Berlin')
    expect(m.timezone).toHaveBeenCalledWith('u1')
    await d.loadNext()
    expect(m.loadNow).toHaveBeenCalledWith('u1', NOW)
  })

  it('a next action counts only while its thought is open', async () => {
    const d = deps()
    selectDb([[{ nextActionThoughtId: 'n1', nextActionLifecycle: 'open' }]])
    await expect(d.projectHasNextAction('p1')).resolves.toBe(true)
    selectDb([[{ nextActionThoughtId: 'n1', nextActionLifecycle: 'completed' }]])
    await expect(d.projectHasNextAction('p1')).resolves.toBe(false)
    selectDb([[{ nextActionThoughtId: null, nextActionLifecycle: null }]])
    await expect(d.projectHasNextAction('p1')).resolves.toBe(false)
  })

  it('projectStatus is null for a missing or non-project entity (ingredient, relative)', async () => {
    const d = deps()
    selectDb([[{ status: null }]])
    await expect(d.projectStatus('e1')).resolves.toBeNull()
    selectDb([[]])
    await expect(d.projectStatus('e1')).resolves.toBeNull()
    selectDb([[{ status: 'active' }]])
    await expect(d.projectStatus('e1')).resolves.toBe('active')
  })

  it('snapshot records lifecycle, category, memberships and every affected project', async () => {
    m.encrypt.mockResolvedValue('enc')
    selectDb([
      [{ lifecycleStatus: 'open', category: 'task' }], // thought
      [{ entityId: 'pA', salience: 0.5, source: 'ingest' }], // memberships
      [{ id: 'pA' }], // member projects
      [{ id: 'pB' }], // sequenced in
      [], // next action pointer
      [{ nextActionThoughtId: 'x', projectDesignatedAt: new Date('2026-11-01T00:00:00Z'), projectStatus: 'active' }], // pA
      [{ nextActionThoughtId: null, projectDesignatedAt: null, projectStatus: 'someday' }], // pB
      [{ nextActionThoughtId: null, projectDesignatedAt: null, projectStatus: 'active' }], // target pC
    ])
    const state = await deps().snapshot('t1', 'pC')
    expect(state).toEqual({
      thoughtId: 't1',
      lifecycleStatus: 'open',
      category: 'task',
      memberships: [{ entityId: 'pA', salience: 0.5, source: 'ingest' }],
      projects: [
        { projectEntityId: 'pA', sequence: [], nextActionThoughtId: 'x', projectDesignatedAt: '2026-11-01T00:00:00.000Z', projectStatus: 'active' },
        { projectEntityId: 'pB', sequence: [], nextActionThoughtId: null, projectDesignatedAt: null, projectStatus: 'someday' },
        { projectEntityId: 'pC', sequence: [], nextActionThoughtId: null, projectDesignatedAt: null, projectStatus: 'active' },
      ],
    })
  })

  it('saveUndo stores the state encrypted under now_card / undo_state, never as plain text', async () => {
    m.encrypt.mockResolvedValue('ciphertext')
    const rec = updateDb()
    const state = { thoughtId: 't1' } as never
    await deps().saveUndo('c1', state)
    expect(m.encrypt).toHaveBeenCalledWith({
      userId: 'u1',
      table: 'now_card',
      column: 'undo_state',
      plaintext: JSON.stringify(state),
    })
    expect(rec.set).toEqual({ undoStateEncrypted: 'ciphertext' })
  })
})

describe('buildNowUndoDeps restores prior state', () => {
  const deps = () => buildNowUndoDeps('u1', NOW)

  it('restores a lifecycle or category only when it differs, through the existing writes', async () => {
    m.setLifecycle.mockResolvedValue({ ok: true })
    m.setCategory.mockResolvedValue({ ok: true })
    const d = deps()

    selectDb([[{ lifecycleStatus: 'completed' }]])
    await d.restoreLifecycle('t1', 'open')
    expect(m.setLifecycle).toHaveBeenCalledWith('u1', 't1', 'open')
    selectDb([[{ lifecycleStatus: 'open' }]])
    await d.restoreLifecycle('t1', 'open')
    expect(m.setLifecycle).toHaveBeenCalledTimes(1)

    selectDb([[{ category: 'note' }]])
    await d.restoreCategory('t1', 'task')
    expect(m.setCategory).toHaveBeenCalledWith('u1', 't1', 'task')
    selectDb([[{ category: 'task' }]])
    await d.restoreCategory('t1', 'task')
    expect(m.setCategory).toHaveBeenCalledTimes(1)
  })

  it('restores a sequence through replaceProjectTaskSequence', async () => {
    await deps().restoreSequence('p1', ['a', 'b'])
    expect(m.replaceSequence).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      orderedThoughtIds: ['a', 'b'],
    })
  })

  it('restores next-action pointer, designated time and status', async () => {
    const rec = updateDb()
    await deps().restoreProjectPointers({
      projectEntityId: 'p1',
      sequence: [],
      nextActionThoughtId: 'a',
      projectDesignatedAt: '2026-11-01T08:00:00.000Z',
      projectStatus: 'someday',
    })
    expect(rec.set).toMatchObject({
      nextActionThoughtId: 'a',
      projectDesignatedAt: new Date('2026-11-01T08:00:00.000Z'),
      projectStatus: 'someday',
    })
    await deps().restoreProjectPointers({
      projectEntityId: 'p1',
      sequence: [],
      nextActionThoughtId: null,
      projectDesignatedAt: null,
      projectStatus: null,
    })
    expect(rec.set).toMatchObject({ nextActionThoughtId: null, projectDesignatedAt: null })
    expect(rec.set).not.toHaveProperty('projectStatus')
  })

  it('removes memberships the answer added, with their graph edges, and keeps recorded ones', async () => {
    const deleted: unknown[] = []
    const inserted: unknown[] = []
    let sel = 0
    m.getDb.mockReturnValue({
      select: () => {
        const rows = sel++ === 0 ? [{ entityId: 'keep' }, { entityId: 'added' }] : []
        const c: Record<string, unknown> = {
          from: () => c,
          where: () => Promise.resolve(rows),
        }
        return c
      },
      delete: () => ({
        where: (cond: unknown) => {
          deleted.push(sql(cond).params)
          return Promise.resolve()
        },
      }),
      insert: () => ({
        values: (v: unknown) => {
          inserted.push(v)
          return { onConflictDoUpdate: async () => undefined }
        },
      }),
    })
    await deps().restoreMemberships('t1', [
      { entityId: 'keep', salience: 0.4, source: 'ingest' },
      { entityId: 'gone', salience: 1, source: 'manual' },
    ])
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toEqual(expect.arrayContaining(['u1', 't1', 'added']))
    expect(m.deleteEdge).toHaveBeenCalledWith({ userId: 'u1', thoughtId: 't1', entityId: 'added' })
    expect(inserted).toHaveLength(2)
    // only the row that was missing gets its edge rebuilt
    expect(m.upsertEdge).toHaveBeenCalledTimes(1)
    expect(m.upsertEdge).toHaveBeenCalledWith({ userId: 'u1', thoughtId: 't1', entityId: 'gone' })
  })
})
