import type { CaptureReviewPart } from './review-parts'
import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMocks = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn(async (_config: unknown) => undefined)
  const insertValues = vi.fn((_values: unknown) => ({ onConflictDoUpdate }))
  const insert = vi.fn((_table: unknown) => ({ values: insertValues }))

  const returning = vi.fn(async (): Promise<unknown[]> => [])
  const updateWhere = vi.fn((_where: unknown) => ({ returning }))
  const updateSet = vi.fn((_set: unknown) => ({ where: updateWhere }))
  const update = vi.fn((_table: unknown) => ({ set: updateSet }))

  const limit = vi.fn(async (): Promise<unknown[]> => [])
  const selectWhere = vi.fn((_where: unknown) => ({ limit }))
  const from = vi.fn((_table: unknown) => ({ where: selectWhere }))
  const select = vi.fn((_fields: unknown) => ({ from }))

  return {
    onConflictDoUpdate,
    insertValues,
    insert,
    returning,
    updateWhere,
    updateSet,
    update,
    limit,
    selectWhere,
    from,
    select,
  }
})

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    insert: dbMocks.insert,
    update: dbMocks.update,
    select: dbMocks.select,
  }),
}))

import {
  completeCaptureReviewAudit,
  failCaptureReviewAudit,
  loadCaptureReviewForAudit,
  loadCaptureReviewSnapshot,
  upsertPendingCaptureReview,
} from './review-store'

const dialect = new PgDialect()

const decisionPart: CaptureReviewPart = {
  part: 'category',
  ref: 'category',
  engine: 'jev_decision',
  label: 'task',
  probability: 0.55,
}

const auditPart: CaptureReviewPart = {
  part: 'missing_names',
  ref: 'missing_names',
  engine: 'jev_audit',
  label: 'none_missing',
  probability: 0.91,
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMocks.returning.mockResolvedValue([])
  dbMocks.limit.mockResolvedValue([])
})

describe('upsertPendingCaptureReview', () => {
  it('inserts a pending_audit review with the parts and no score', async () => {
    await upsertPendingCaptureReview({ userId: 'u1', thoughtId: 't1', parts: [decisionPart] })

    expect(dbMocks.insertValues).toHaveBeenCalledTimes(1)
    expect(dbMocks.insertValues.mock.calls[0][0]).toMatchObject({
      userId: 'u1',
      thoughtId: 't1',
      parts: [decisionPart],
      score: null,
      status: 'pending_audit',
      auditError: null,
    })
  })

  it('upserts on thought_id, replacing parts, score, status and error only', async () => {
    await upsertPendingCaptureReview({ userId: 'u1', thoughtId: 't1', parts: [decisionPart] })

    const config = dbMocks.onConflictDoUpdate.mock.calls[0][0] as {
      target: { name: string }
      set: Record<string, unknown>
    }
    expect(config.target.name).toBe('thought_id')
    expect(Object.keys(config.set).sort()).toEqual([
      'auditError',
      'parts',
      'score',
      'status',
      'updatedAt',
    ])
    expect(config.set).toMatchObject({
      parts: [decisionPart],
      score: null,
      status: 'pending_audit',
      auditError: null,
    })
  })

  it('leaves the vote columns out of both the insert and the conflict update', async () => {
    await upsertPendingCaptureReview({ userId: 'u1', thoughtId: 't1', parts: [] })

    const insertKeys = Object.keys(dbMocks.insertValues.mock.calls[0][0] as object)
    const setKeys = Object.keys(
      (dbMocks.onConflictDoUpdate.mock.calls[0][0] as { set: object }).set,
    )
    for (const vote of [
      'verdict',
      'votedAt',
      'votedOn',
      'reasonEncrypted',
      'reasonKind',
      'editAppliedAt',
    ]) {
      expect(insertKeys).not.toContain(vote)
      expect(setKeys).not.toContain(vote)
    }
  })

  it('accepts an empty parts list (nothing was enforced; the audit still scores)', async () => {
    await expect(
      upsertPendingCaptureReview({ userId: 'u1', thoughtId: 't1', parts: [] }),
    ).resolves.toBeUndefined()
  })

  it('refuses parts that carry anything beyond the strict shape, before touching the DB', async () => {
    const leaking = [{ ...decisionPart, surface: 'Anna' }] as unknown as CaptureReviewPart[]
    await expect(
      upsertPendingCaptureReview({ userId: 'u1', thoughtId: 't1', parts: leaking }),
    ).rejects.toThrow(/invalid capture review parts/)
    expect(dbMocks.insert).not.toHaveBeenCalled()
  })

  it('refuses a blank user or thought id', async () => {
    await expect(
      upsertPendingCaptureReview({ userId: ' ', thoughtId: 't1', parts: [] }),
    ).rejects.toThrow(/userId/)
    await expect(
      upsertPendingCaptureReview({ userId: 'u1', thoughtId: '', parts: [] }),
    ).rejects.toThrow(/thoughtId/)
    expect(dbMocks.insert).not.toHaveBeenCalled()
  })

  it('lets a database failure surface (never swallowed)', async () => {
    dbMocks.onConflictDoUpdate.mockRejectedValueOnce(new Error('connection reset'))
    await expect(
      upsertPendingCaptureReview({ userId: 'u1', thoughtId: 't1', parts: [] }),
    ).rejects.toThrow('connection reset')
  })
})

describe('loadCaptureReviewForAudit', () => {
  it('returns null when the thought has no review', async () => {
    expect(await loadCaptureReviewForAudit('t1')).toBeNull()
  })

  it('returns the status and the validated parts', async () => {
    dbMocks.limit.mockResolvedValueOnce([{ status: 'pending_audit', parts: [decisionPart] }])
    expect(await loadCaptureReviewForAudit('t1')).toEqual({
      status: 'pending_audit',
      parts: [decisionPart],
    })
  })

  it('refuses stored parts that no longer pass the strict shape', async () => {
    dbMocks.limit.mockResolvedValueOnce([
      { status: 'pending_audit', parts: [{ ...decisionPart, surface: 'Anna' }] },
    ])
    await expect(loadCaptureReviewForAudit('t1')).rejects.toThrow(/invalid capture review parts/)
  })
})

describe('completeCaptureReviewAudit', () => {
  const input = {
    thoughtId: 't1',
    expectedParts: [decisionPart],
    parts: [decisionPart, auditPart],
    score: 0.55,
  }

  it('writes the scored review and reports it applied', async () => {
    dbMocks.returning.mockResolvedValueOnce([{ id: 'r1' }])

    expect(await completeCaptureReviewAudit(input)).toBe(true)

    const set = dbMocks.updateSet.mock.calls[0][0] as Record<string, unknown>
    expect(set).toMatchObject({
      parts: [decisionPart, auditPart],
      score: 0.55,
      status: 'scored',
      auditError: null,
    })
    expect(Object.keys(set).sort()).toEqual(['auditError', 'parts', 'score', 'status', 'updatedAt'])
  })

  it('only applies while the review still carries the parts the audit started from', async () => {
    dbMocks.returning.mockResolvedValueOnce([{ id: 'r1' }])
    await completeCaptureReviewAudit(input)

    const where = dbMocks.updateWhere.mock.calls[0][0] as Parameters<PgDialect['sqlToQuery']>[0]
    const { sql: text, params } = dialect.sqlToQuery(where)
    expect(text).toMatch(/"thought_id" = \$\d/)
    expect(text).toMatch(/"status" = \$\d/)
    expect(text).toMatch(/"parts" = \$\d::jsonb/)
    expect(params).toEqual(['t1', 'pending_audit', JSON.stringify([decisionPart])])
  })

  it('reports not applied when a newer enrichment replaced the review meanwhile', async () => {
    dbMocks.returning.mockResolvedValueOnce([])
    expect(await completeCaptureReviewAudit(input)).toBe(false)
  })

  it('refuses a score outside 0..1 or parts outside the strict shape', async () => {
    await expect(completeCaptureReviewAudit({ ...input, score: 1.2 })).rejects.toThrow(/score/)
    await expect(
      completeCaptureReviewAudit({
        ...input,
        parts: [{ ...auditPart, event: 'dentist' } as unknown as CaptureReviewPart],
      }),
    ).rejects.toThrow(/invalid capture review parts/)
    expect(dbMocks.update).not.toHaveBeenCalled()
  })
})

describe('failCaptureReviewAudit', () => {
  it('marks a pending review audit_failed with the explanation and clears nothing else', async () => {
    dbMocks.returning.mockResolvedValueOnce([{ id: 'r1' }])

    expect(
      await failCaptureReviewAudit({
        thoughtId: 't1',
        auditError: 'Audit failed at step: decision_model.',
      }),
    ).toBe(true)

    const set = dbMocks.updateSet.mock.calls[0][0] as Record<string, unknown>
    expect(set).toMatchObject({
      status: 'audit_failed',
      auditError: 'Audit failed at step: decision_model.',
    })
    expect(Object.keys(set).sort()).toEqual(['auditError', 'status', 'updatedAt'])

    const where = dbMocks.updateWhere.mock.calls[0][0] as Parameters<PgDialect['sqlToQuery']>[0]
    const { sql: text, params } = dialect.sqlToQuery(where)
    expect(text).toMatch(/"thought_id" = \$\d/)
    expect(text).toMatch(/"status" = \$\d/)
    expect(params).toEqual(['t1', 'pending_audit'])
  })

  it('also requires the parts the audit started from when it knows them', async () => {
    dbMocks.returning.mockResolvedValueOnce([{ id: 'r1' }])

    await failCaptureReviewAudit({
      thoughtId: 't1',
      auditError: 'x',
      expectedParts: [decisionPart],
    })

    const where = dbMocks.updateWhere.mock.calls[0][0] as Parameters<PgDialect['sqlToQuery']>[0]
    const { sql: text, params } = dialect.sqlToQuery(where)
    expect(text).toMatch(/"parts" = \$\d::jsonb/)
    expect(params).toEqual(['t1', 'pending_audit', JSON.stringify([decisionPart])])
  })

  it('reports not applied when the review is no longer pending (a newer enrichment owns it)', async () => {
    dbMocks.returning.mockResolvedValueOnce([])
    expect(await failCaptureReviewAudit({ thoughtId: 't1', auditError: 'x' })).toBe(false)
  })

  it('refuses a blank explanation', async () => {
    await expect(failCaptureReviewAudit({ thoughtId: 't1', auditError: ' ' })).rejects.toThrow(
      /auditError/,
    )
  })
})

describe('loadCaptureReviewSnapshot (the read behind get_capture_review)', () => {
  const ID = '0b6f3f8e-5c1a-4d7e-9a2b-3c4d5e6f7a8b'
  const updatedAt = new Date('2026-10-27T10:05:00Z')
  const editAppliedAt = new Date('2026-10-27T10:09:00Z')

  function reviewRow(patch: Record<string, unknown> = {}) {
    return {
      status: 'scored',
      score: 0.62,
      parts: [decisionPart, auditPart],
      auditError: null,
      verdict: 'down',
      votedOn: null,
      reasonKind: 'wrong_name',
      editAppliedAt,
      updatedAt,
      ...patch,
    }
  }

  it('is null when the thought does not exist for this user (no review lookup follows)', async () => {
    dbMocks.limit.mockResolvedValueOnce([])
    await expect(loadCaptureReviewSnapshot({ userId: 'u1', thoughtId: ID })).resolves.toBeNull()
    expect(dbMocks.select).toHaveBeenCalledTimes(1)
    const where = dialect.sqlToQuery(dbMocks.selectWhere.mock.calls[0][0] as never)
    expect(where.sql).toContain('"thought"."id" = $1')
    expect(where.sql).toContain('"thought"."user_id" = $2')
    expect(where.params).toEqual([ID, 'u1'])
  })

  it('is the thought category and lifecycle with the review, parts validated', async () => {
    dbMocks.limit
      .mockResolvedValueOnce([{ category: 'task', lifecycleStatus: 'archived' }])
      .mockResolvedValueOnce([reviewRow()])

    await expect(loadCaptureReviewSnapshot({ userId: 'u1', thoughtId: ID })).resolves.toEqual({
      category: 'task',
      lifecycleStatus: 'archived',
      review: {
        status: 'scored',
        score: 0.62,
        parts: [decisionPart, auditPart],
        auditError: null,
        verdict: 'down',
        votedOn: null,
        reasonKind: 'wrong_name',
        editAppliedAt,
        updatedAt,
      },
    })
    const where = dialect.sqlToQuery(dbMocks.selectWhere.mock.calls[1][0] as never)
    expect(where.sql).toContain('"capture_review"."thought_id" = $1')
    expect(where.sql).toContain('"capture_review"."user_id" = $2')
    expect(where.params).toEqual([ID, 'u1'])
  })

  it('has no review for a thought that was never reviewed', async () => {
    dbMocks.limit
      .mockResolvedValueOnce([{ category: 'idea', lifecycleStatus: 'open' }])
      .mockResolvedValueOnce([])
    await expect(loadCaptureReviewSnapshot({ userId: 'u1', thoughtId: ID })).resolves.toEqual({
      category: 'idea',
      lifecycleStatus: 'open',
      review: null,
    })
  })

  it('never selects the reason (encrypted or not) or any thought text', async () => {
    dbMocks.limit
      .mockResolvedValueOnce([{ category: 'task', lifecycleStatus: 'open' }])
      .mockResolvedValueOnce([reviewRow()])
    await loadCaptureReviewSnapshot({ userId: 'u1', thoughtId: ID })
    const thoughtFields = Object.keys(dbMocks.select.mock.calls[0][0] as object)
    const reviewFields = Object.keys(dbMocks.select.mock.calls[1][0] as object)
    expect(thoughtFields.sort()).toEqual(['category', 'lifecycleStatus'])
    expect(reviewFields.sort()).toEqual([
      'auditError',
      'editAppliedAt',
      'parts',
      'reasonKind',
      'score',
      'status',
      'updatedAt',
      'verdict',
      'votedOn',
    ])
  })

  it('refuses stored parts that break the strict shape, before anything is shown', async () => {
    dbMocks.limit
      .mockResolvedValueOnce([{ category: 'task', lifecycleStatus: 'open' }])
      .mockResolvedValueOnce([reviewRow({ parts: [{ ...decisionPart, surface: 'Anna' }] })])
    await expect(loadCaptureReviewSnapshot({ userId: 'u1', thoughtId: ID })).rejects.toThrow(
      'invalid capture review parts',
    )
  })

  it('rejects empty ids before any query', async () => {
    await expect(loadCaptureReviewSnapshot({ userId: '', thoughtId: ID })).rejects.toThrow(
      'userId must not be empty',
    )
    await expect(loadCaptureReviewSnapshot({ userId: 'u1', thoughtId: ' ' })).rejects.toThrow(
      'thoughtId must not be empty',
    )
    expect(dbMocks.select).not.toHaveBeenCalled()
  })
})
