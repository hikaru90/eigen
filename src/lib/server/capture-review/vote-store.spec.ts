import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  const returningInsert = vi.fn(async (): Promise<unknown[]> => [])
  const onConflictDoNothing = vi.fn((_config: unknown) => ({ returning: returningInsert }))
  const insertValues = vi.fn((_values: unknown) => ({ onConflictDoNothing }))
  const insert = vi.fn((_table: unknown) => ({ values: insertValues }))

  const returningUpdate = vi.fn(async (): Promise<unknown[]> => [])
  const updateWhere = vi.fn((_where: unknown) => ({ returning: returningUpdate }))
  const updateSet = vi.fn((_set: unknown) => ({ where: updateWhere }))
  const update = vi.fn((_table: unknown) => ({ set: updateSet }))

  const deleteWhere = vi.fn(async (_where: unknown) => undefined)
  const del = vi.fn((_table: unknown) => ({ where: deleteWhere }))

  // select().from().where() is awaited directly for lists and `.limit(1)`-ed for one row.
  const rows = { current: [] as unknown[] }
  const selectWhere = vi.fn((_where: unknown) => {
    const result = Promise.resolve(rows.current)
    return Object.assign(result, { limit: vi.fn(async () => rows.current) })
  })
  const from = vi.fn((_table: unknown) => ({ where: selectWhere }))
  const select = vi.fn((_fields: unknown) => ({ from }))

  return {
    returningInsert,
    onConflictDoNothing,
    insertValues,
    insert,
    returningUpdate,
    updateWhere,
    updateSet,
    update,
    deleteWhere,
    del,
    rows,
    selectWhere,
    from,
    select,
  }
})

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    insert: dbMocks.insert,
    update: dbMocks.update,
    delete: dbMocks.del,
    select: dbMocks.select,
  }),
}))

import {
  createPendingCaptureReviewIfMissing,
  deleteCaptureReview,
  loadCaptureVerdicts,
  loadVoteTarget,
  saveCaptureVote,
} from './vote-store'

const dialect = new PgDialect()
const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'

beforeEach(() => {
  vi.clearAllMocks()
  dbMocks.rows.current = []
  dbMocks.returningInsert.mockResolvedValue([])
  dbMocks.returningUpdate.mockResolvedValue([])
})

describe('loadVoteTarget', () => {
  it('is the thought category, read for this user only', async () => {
    dbMocks.rows.current = [{ category: 'task' }]
    await expect(loadVoteTarget({ userId: 'u1', thoughtId: ID })).resolves.toEqual({
      category: 'task',
    })
    const where = dialect.sqlToQuery(dbMocks.selectWhere.mock.calls[0][0] as never)
    expect(where.sql).toContain('"thought"."id" = $1')
    expect(where.sql).toContain('"thought"."user_id" = $2')
    expect(where.params).toEqual([ID, 'u1'])
  })

  it('is null for a thought that does not exist (or is not the user’s)', async () => {
    dbMocks.rows.current = []
    await expect(loadVoteTarget({ userId: 'u1', thoughtId: ID })).resolves.toBeNull()
  })

  it('rejects empty ids before any query', async () => {
    await expect(loadVoteTarget({ userId: ' ', thoughtId: ID })).rejects.toThrow('userId must not be empty')
    await expect(loadVoteTarget({ userId: 'u1', thoughtId: '' })).rejects.toThrow(
      'thoughtId must not be empty',
    )
    expect(dbMocks.select).not.toHaveBeenCalled()
  })
})

describe('createPendingCaptureReviewIfMissing', () => {
  it('inserts a pending_audit review with no parts and no score, and returns its id', async () => {
    dbMocks.returningInsert.mockResolvedValue([{ id: 'review-1' }])

    await expect(createPendingCaptureReviewIfMissing({ userId: 'u1', thoughtId: ID })).resolves.toBe(
      'review-1',
    )

    expect(dbMocks.insertValues.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      thoughtId: ID,
      parts: [],
      score: null,
      status: 'pending_audit',
      auditError: null,
    })
    const values = dbMocks.insertValues.mock.calls[0][0] as object
    for (const vote of ['verdict', 'votedAt', 'votedOn', 'reasonEncrypted', 'reasonKind', 'editAppliedAt']) {
      expect(Object.keys(values)).not.toContain(vote)
    }
  })

  it('does nothing on conflict (a review from enrichment is never overwritten) and returns null', async () => {
    dbMocks.returningInsert.mockResolvedValue([])

    await expect(
      createPendingCaptureReviewIfMissing({ userId: 'u1', thoughtId: ID }),
    ).resolves.toBeNull()

    const config = dbMocks.onConflictDoNothing.mock.calls[0][0] as { target: { name: string } }
    expect(config.target.name).toBe('thought_id')
  })
})

describe('deleteCaptureReview', () => {
  it('deletes exactly the review it was given', async () => {
    await deleteCaptureReview({ userId: 'u1', reviewId: 'review-1' })
    const where = dialect.sqlToQuery(dbMocks.deleteWhere.mock.calls[0][0] as never)
    expect(where.sql).toContain('"capture_review"."id" = $1')
    expect(where.params).toEqual(['review-1', 'u1'])
  })
})

describe('saveCaptureVote', () => {
  const base = {
    userId: 'u1',
    thoughtId: ID,
    verdict: 'down' as const,
    place: 'mesh' as const,
    reasonEncrypted: 'cipher',
    reasonKind: 'wrong_name',
  }

  it('writes the vote columns of this user’s review for the thought', async () => {
    dbMocks.returningUpdate.mockResolvedValue([{ id: 'review-1' }])
    const editAppliedAt = new Date('2026-10-27T10:00:00Z')

    await saveCaptureVote({ ...base, editAppliedAt })

    expect(dbMocks.updateSet.mock.calls[0][0]).toMatchObject({
      verdict: 'down',
      votedOn: 'mesh',
      reasonEncrypted: 'cipher',
      reasonKind: 'wrong_name',
      editAppliedAt,
    })
    expect((dbMocks.updateSet.mock.calls[0][0] as { votedAt: unknown }).votedAt).toBeInstanceOf(Date)
    const where = dialect.sqlToQuery(dbMocks.updateWhere.mock.calls[0][0] as never)
    expect(where.sql).toContain('"capture_review"."thought_id" = $1')
    expect(where.params).toEqual([ID, 'u1'])
  })

  it('stores the place of the two app places as they are', async () => {
    dbMocks.returningUpdate.mockResolvedValue([{ id: 'review-1' }])
    await saveCaptureVote({ ...base, place: 'capture' })
    await saveCaptureVote({ ...base, place: 'mesh' })
    expect(dbMocks.updateSet.mock.calls[0][0]).toMatchObject({ votedOn: 'capture' })
    expect(dbMocks.updateSet.mock.calls[1][0]).toMatchObject({ votedOn: 'mesh' })
  })

  it('stores a vote from an agent over MCP with voted_on NULL (the one place that maps it)', async () => {
    dbMocks.returningUpdate.mockResolvedValue([{ id: 'review-1' }])
    await saveCaptureVote({ ...base, place: 'mcp' })
    const set = dbMocks.updateSet.mock.calls[0][0] as Record<string, unknown>
    expect(set).toHaveProperty('votedOn', null)
    expect(Object.values(set)).not.toContain('mcp')
  })

  it('leaves updated_at alone: it tracks the audit columns, so a later edit_applied_at can tell the parts are older', async () => {
    dbMocks.returningUpdate.mockResolvedValue([{ id: 'review-1' }])
    await saveCaptureVote({ ...base, editAppliedAt: new Date('2026-10-27T10:00:00Z') })
    expect(Object.keys(dbMocks.updateSet.mock.calls[0][0] as object)).not.toContain('updatedAt')
  })

  it('never touches the audit columns (parts, score, status)', async () => {
    dbMocks.returningUpdate.mockResolvedValue([{ id: 'review-1' }])
    await saveCaptureVote({ ...base, editAppliedAt: null })
    const keys = Object.keys(dbMocks.updateSet.mock.calls[0][0] as object)
    for (const audit of ['parts', 'score', 'status', 'auditError']) {
      expect(keys).not.toContain(audit)
    }
  })

  it('leaves edit_applied_at alone when the caller does not name it, and clears it when told null', async () => {
    dbMocks.returningUpdate.mockResolvedValue([{ id: 'review-1' }])

    await saveCaptureVote({ ...base, reasonEncrypted: null, reasonKind: null })
    expect(Object.keys(dbMocks.updateSet.mock.calls[0][0] as object)).not.toContain('editAppliedAt')
    expect(dbMocks.updateSet.mock.calls[0][0]).toMatchObject({
      reasonEncrypted: null,
      reasonKind: null,
    })

    await saveCaptureVote({ ...base, editAppliedAt: null })
    expect(dbMocks.updateSet.mock.calls[1][0]).toMatchObject({ editAppliedAt: null })
  })

  it('fails loudly when there is no review to write to', async () => {
    dbMocks.returningUpdate.mockResolvedValue([])
    await expect(saveCaptureVote(base)).rejects.toThrow('no capture review to store the vote on')
  })
})

describe('loadCaptureVerdicts', () => {
  it('maps thought id to the stored verdict, for this user, only for voted thoughts', async () => {
    dbMocks.rows.current = [
      { thoughtId: 't1', verdict: 'up' },
      { thoughtId: 't2', verdict: 'down' },
    ]

    const verdicts = await loadCaptureVerdicts('u1', ['t1', 't2', 't3'])

    expect([...verdicts.entries()]).toEqual([
      ['t1', 'up'],
      ['t2', 'down'],
    ])
    const where = dialect.sqlToQuery(dbMocks.selectWhere.mock.calls[0][0] as never)
    expect(where.sql).toContain('"capture_review"."user_id" = $1')
    expect(where.sql).toContain('"capture_review"."verdict" is not null')
    expect(where.params).toContain('u1')
  })

  it('selects the verdict only: never the reason, its kind or the parts', async () => {
    dbMocks.rows.current = []
    await loadCaptureVerdicts('u1', ['t1'])
    const fields = Object.keys(dbMocks.select.mock.calls[0][0] as object)
    expect(fields.sort()).toEqual(['thoughtId', 'verdict'])
  })

  it('asks nothing when there are no thoughts', async () => {
    const verdicts = await loadCaptureVerdicts('u1', [])
    expect(verdicts.size).toBe(0)
    expect(dbMocks.select).not.toHaveBeenCalled()
  })
})
