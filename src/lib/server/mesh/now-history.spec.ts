import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getDb: vi.fn(), decrypt: vi.fn() }))
vi.mock('$lib/server/db', () => ({ getDb: m.getDb }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({ decryptTenantValue: m.decrypt }))

import {
  countNowHistory,
  loadNowHistory,
  NOW_HISTORY_PAGE_SIZE,
  NowHistoryCursorError,
} from './now-history'

const sql = (cond: unknown) => new PgDialect().sqlToQuery(cond as never)

type Row = {
  id: string
  kind: 'do' | 'sort' | 'file' | 'unblock'
  answer: string
  answeredAt: Date
  targetThoughtId: string | null
  targetProjectEntityId: string | null
  payloadEncrypted: string
}

function row(n: number, over: Partial<Row> = {}): Row {
  return {
    id: `c${n}`,
    kind: 'do',
    answer: 'done',
    answeredAt: new Date(Date.UTC(2026, 10, 9, 12, 0, 60 - n)),
    targetThoughtId: `t${n}`,
    targetProjectEntityId: null,
    payloadEncrypted: `enc:${n}`,
    ...over,
  }
}

/** A db whose select() chains resolve to the next scripted result; `where` conditions are recorded. */
function selectDb(results: unknown[][]) {
  const wheres: unknown[] = []
  const limits: number[] = []
  let i = 0
  const chain = () => {
    const rows = results[i++] ?? []
    const c: Record<string, unknown> = {
      from: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      where: (cond: unknown) => {
        wheres.push(cond)
        return c
      },
      orderBy: () => c,
      limit: (n: number) => {
        limits.push(n)
        return c
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(res, rej),
    }
    return c
  }
  m.getDb.mockReturnValue({ select: chain })
  return { wheres, limits, selects: () => i }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.decrypt.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
    JSON.stringify({ text: `Text of ${ciphertext}`, why: 'why', suggestedStep: null }),
  )
})

describe('loadNowHistory', () => {
  it('lists only this user\'s answered cards, newest first, with decrypted text', async () => {
    const db = selectDb([[row(1), row(2)]])

    const page = await loadNowHistory('u1', {})

    const q = sql(db.wheres[0])
    expect(q.sql).toContain('"now_card"."user_id" = $')
    expect(q.sql).toContain('"now_card"."status" = $')
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'answered']))
    expect(page.items.map((i) => i.cardId)).toEqual(['c1', 'c2'])
    expect(page.items[0]).toEqual({
      cardId: 'c1',
      kind: 'do',
      text: 'Text of enc:1',
      answer: 'done',
      projectLabel: null,
      answeredAt: '2026-11-09T12:00:59.000Z',
      thoughtId: 't1',
    })
    expect(m.decrypt).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', table: 'now_card', column: 'payload', ciphertext: 'enc:1' }),
    )
    expect(page.nextCursor).toBeNull()
  })

  it('undone cards are not listed: the filter is status answered, which Undo clears', async () => {
    const db = selectDb([[]])
    await expect(loadNowHistory('u1', {})).resolves.toEqual({ items: [], nextCursor: null })
    expect(sql(db.wheres[0]).params).not.toContain('pending')
  })

  it('pages by 50: asks for one more, returns 50 and a cursor to the 50th', async () => {
    expect(NOW_HISTORY_PAGE_SIZE).toBe(50)
    const rows = Array.from({ length: 51 }, (_, n) => row(n + 1))
    const db = selectDb([rows])

    const page = await loadNowHistory('u1', {})

    expect(db.limits).toEqual([51])
    expect(page.items).toHaveLength(50)
    expect(page.items.at(-1)?.cardId).toBe('c50')
    expect(page.nextCursor).toEqual(expect.any(String))
  })

  it('exactly 50 left means no cursor', async () => {
    selectDb([Array.from({ length: 50 }, (_, n) => row(n + 1))])
    expect((await loadNowHistory('u1', {})).nextCursor).toBeNull()
  })

  it('the cursor continues strictly after the last item', async () => {
    selectDb([Array.from({ length: 51 }, (_, n) => row(n + 1))])
    const first = await loadNowHistory('u1', {})

    const db = selectDb([[row(51)]])
    const second = await loadNowHistory('u1', { before: first.nextCursor as string })

    const q = sql(db.wheres[0])
    expect(q.sql).toContain('"now_card"."answered_at" <')
    expect(q.params).toEqual(expect.arrayContaining(['c50']))
    expect(q.params.some((p) => String(p).startsWith('2026-11-09T12:00:10'))).toBe(true)
    expect(second.items.map((i) => i.cardId)).toEqual(['c51'])
  })

  it('rejects a cursor it did not issue, before any query', async () => {
    const db = selectDb([[]])
    await expect(loadNowHistory('u1', { before: 'nonsense' })).rejects.toBeInstanceOf(
      NowHistoryCursorError,
    )
    expect(db.selects()).toBe(0)
  })

  it('names the project for answers that moved something into it', async () => {
    selectDb([
      [
        row(1, { kind: 'file', answer: 'yes', targetProjectEntityId: 'p1' }),
        row(2, { kind: 'unblock', answer: 'someday', targetThoughtId: null, targetProjectEntityId: 'p2' }),
        row(3, { kind: 'file', answer: 'not_a_task', targetProjectEntityId: 'p1' }),
        row(4, { kind: 'do', answer: 'done' }),
      ],
      [
        { id: 'p1', label: 'Empathy Link' },
        { id: 'p2', label: 'Sewer' },
      ],
    ])

    const { items } = await loadNowHistory('u1', {})

    expect(items.map((i) => i.projectLabel)).toEqual(['Empathy Link', 'Sewer', null, null])
  })

  it('other_project: the project is the one the thought now belongs to', async () => {
    const db = selectDb([
      [row(1, { kind: 'file', answer: 'other_project', targetProjectEntityId: 'p1' })],
      [{ thoughtId: 't1', label: 'Hydra' }],
    ])

    const { items } = await loadNowHistory('u1', {})

    expect(items[0].projectLabel).toBe('Hydra')
    const q = sql(db.wheres[1])
    expect(q.params).toEqual(expect.arrayContaining(['u1']))
  })

  it('other_project with no membership left shows no project name', async () => {
    selectDb([[row(1, { kind: 'file', answer: 'other_project' })], []])
    expect((await loadNowHistory('u1', {})).items[0].projectLabel).toBeNull()
  })

  it('makes no label query when no row needs one', async () => {
    const db = selectDb([[row(1), row(2, { kind: 'sort', answer: 'drop' })]])
    await loadNowHistory('u1', {})
    expect(db.selects()).toBe(1)
  })
})

describe('countNowHistory', () => {
  it('counts this user\'s answered cards', async () => {
    const db = selectDb([[{ n: 7 }]])
    await expect(countNowHistory('u1')).resolves.toBe(7)
    const q = sql(db.wheres[0])
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'answered']))
  })

  it('is 0 for a user with none', async () => {
    selectDb([[{ n: 0 }]])
    await expect(countNowHistory('u1')).resolves.toBe(0)
  })
})
