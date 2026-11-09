import { PgDialect } from 'drizzle-orm/pg-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, encryptMock, decryptMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  encryptMock: vi.fn(),
  decryptMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: encryptMock,
  decryptTenantValue: decryptMock,
}))

import type { NowCandidates } from './now-candidates'
import type { NowDeckContext, NowDeckDraft } from './now-deck'
import {
  buildNowCardRows,
  expireEarlierNowCards,
  isNowCardStale,
  loadOtherActiveProjects,
  NOW_DECKS_PER_DAY,
  resolveNow,
  writeNowDeck,
  type NowCardPayload,
  type NowStoreDeps,
  type StoredNowCard,
} from './now-store'

const candidates: NowCandidates = {
  thoughts: [
    {
      thoughtId: 'th-1',
      category: 'task',
      snippet: 'Send the form',
      author: 'user',
      createdAt: '2026-10-01T10:00:00.000Z',
      project: null,
      eventAt: null,
      skipCount: 0,
    },
  ],
  projects: [],
  candidatesOmitted: 12,
}

const context = {
  language: 'en',
  localDate: '2026-11-09',
  weekday: 'Monday',
  localTime: '09:30',
  ontologyKeys: ['task', 'note'],
  candidates,
} as NowDeckContext

const drafts: NowDeckDraft[] = [
  {
    kind: 'do',
    thoughtId: 'th-1',
    projectEntityId: null,
    text: 'Send the form to the accountant.',
    why: 'Due in 9 days.',
    suggestedStep: null,
    notTaskCategory: null,
  },
  {
    kind: 'unblock',
    thoughtId: null,
    projectEntityId: 'pr-2',
    text: 'Sewer has no next step.',
    why: 'Nothing is marked next.',
    suggestedStep: 'Book the site visit',
    notTaskCategory: null,
  },
  {
    kind: 'file',
    thoughtId: 'th-3',
    projectEntityId: 'pr-1',
    text: 'File this under Taxes?',
    why: 'It sounds like Taxes.',
    suggestedStep: null,
    notTaskCategory: 'note',
  },
]

function stored(position: number, kind: StoredNowCard['kind'] = 'do'): StoredNowCard {
  return {
    id: `c${position}`,
    kind,
    position,
    targetThoughtId: kind === 'unblock' ? null : `th-${position}`,
    targetProjectEntityId: kind === 'do' ? null : `pr-${position}`,
    payloadEncrypted: `enc:${position}`,
  }
}

function payloadFor(card: StoredNowCard): NowCardPayload {
  return {
    text: `Text ${card.position}`,
    why: `Why ${card.position}`,
    suggestedStep: card.kind === 'unblock' ? 'Book the site visit' : null,
    notTaskCategory: card.kind === 'file' ? 'note' : null,
    candidatesOmitted: 12,
  }
}

function makeDeps(overrides: Partial<NowStoreDeps> = {}) {
  const deps = {
    expireEarlier: vi.fn().mockResolvedValue(undefined),
    readToday: vi.fn().mockResolvedValue({ deckCount: 0, pending: [] }),
    isStale: vi.fn().mockResolvedValue(false),
    markSuperseded: vi.fn().mockResolvedValue(undefined),
    loadCandidates: vi.fn().mockResolvedValue(candidates),
    loadContext: vi.fn().mockResolvedValue(context),
    generate: vi.fn().mockResolvedValue(drafts),
    writeDeck: vi.fn(),
    decryptPayload: vi.fn(async (card: StoredNowCard) => payloadFor(card)),
    resolveProject: vi.fn().mockResolvedValue(null),
    otherProjects: vi.fn().mockResolvedValue([]),
    ...overrides,
  } satisfies NowStoreDeps
  if (!overrides.writeDeck) {
    deps.writeDeck.mockImplementation(async () => [stored(1), stored(2, 'unblock'), stored(3, 'file')])
  }
  return deps
}

describe('resolveNow (NOW-7)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC1: with no deck today and candidates, one call writes the deck and the first card shows', async () => {
    const deps = makeDeps()

    const result = await resolveNow(deps)

    expect(deps.loadContext).toHaveBeenCalledWith(candidates)
    expect(deps.generate).toHaveBeenCalledTimes(1)
    expect(deps.generate).toHaveBeenCalledWith(context)
    expect(deps.writeDeck).toHaveBeenCalledWith(1, drafts, 12)
    expect(result).toEqual({
      state: 'card',
      card: {
        id: 'c1',
        kind: 'do',
        text: 'Text 1',
        why: 'Why 1',
        project: null,
        answers: ['done', 'not_now', 'too_big'],
      },
      remaining: 2,
      candidatesOmitted: 12,
    })
  })

  it('numbers the next deck by the decks already written today', async () => {
    const deps = makeDeps({ readToday: vi.fn().mockResolvedValue({ deckCount: 2, pending: [] }) })
    await resolveNow(deps)
    expect(deps.writeDeck).toHaveBeenCalledWith(3, drafts, 12)
  })

  it('AC2: a pending deck serves its earliest card with no LLM call and no candidate query', async () => {
    const deps = makeDeps({
      readToday: vi.fn().mockResolvedValue({
        deckCount: 1,
        pending: [stored(2, 'unblock'), stored(3, 'file'), stored(4, 'do')],
      }),
    })

    const result = await resolveNow(deps)

    expect(deps.loadCandidates).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.writeDeck).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      state: 'card',
      card: {
        id: 'c2',
        kind: 'unblock',
        text: 'Text 2',
        suggestedStep: 'Book the site visit',
        answers: ['yes', 'something_else', 'someday', 'finished'],
      },
      remaining: 2,
      candidatesOmitted: 12,
    })
  })

  it('gives each kind its own stable answer keys (NOW-1)', async () => {
    const answersFor = async (kind: StoredNowCard['kind']) => {
      const deps = makeDeps({
        readToday: vi.fn().mockResolvedValue({ deckCount: 1, pending: [stored(1, kind)] }),
      })
      const result = await resolveNow(deps)
      return result.state === 'card' ? result.card.answers : null
    }
    expect(await answersFor('do')).toEqual(['done', 'not_now', 'too_big'])
    expect(await answersFor('sort')).toEqual(['done', 'drop', 'keep'])
    expect(await answersFor('file')).toEqual(['yes', 'other_project', 'not_a_task'])
    expect(await answersFor('unblock')).toEqual(['yes', 'something_else', 'someday', 'finished'])
  })

  it('names the card\'s project when it has one', async () => {
    const deps = makeDeps({
      readToday: vi.fn().mockResolvedValue({ deckCount: 1, pending: [stored(3, 'file')] }),
      resolveProject: vi.fn().mockResolvedValue({ id: 'pr-3', label: 'Taxes' }),
    })
    const result = await resolveNow(deps)
    expect(result).toMatchObject({ card: { project: { id: 'pr-3', label: 'Taxes' } } })
    expect(deps.resolveProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'c3' }))
  })

  it('file cards carry the other active projects for the picker; other kinds do not ask for them', async () => {
    const others = [
      { id: 'pr-8', label: 'Hydra' },
      { id: 'pr-9', label: 'Sewer' },
    ]
    const fileDeps = makeDeps({
      readToday: vi.fn().mockResolvedValue({ deckCount: 1, pending: [stored(3, 'file')] }),
      otherProjects: vi.fn().mockResolvedValue(others),
    })
    const file = await resolveNow(fileDeps)
    expect(file).toMatchObject({ card: { kind: 'file', otherProjects: others } })
    expect(fileDeps.otherProjects).toHaveBeenCalledWith(expect.objectContaining({ id: 'c3' }))

    for (const kind of ['do', 'sort', 'unblock'] as const) {
      const deps = makeDeps({
        readToday: vi.fn().mockResolvedValue({ deckCount: 1, pending: [stored(1, kind)] }),
      })
      const result = await resolveNow(deps)
      expect(deps.otherProjects).not.toHaveBeenCalled()
      expect(result.state === 'card' && 'otherProjects' in result.card).toBe(false)
    }
  })

  it('earlier days: pending cards of earlier local days are expired before anything is read', async () => {
    const order: string[] = []
    const deps = makeDeps({
      expireEarlier: vi.fn(async () => void order.push('expire')),
      readToday: vi.fn(async () => {
        order.push('read')
        return { deckCount: 0, pending: [] }
      }),
    })
    await resolveNow(deps)
    expect(order).toEqual(['expire', 'read'])
  })

  it('AC14: a card whose thought is no longer open is superseded and the next one shows', async () => {
    const deps = makeDeps({
      readToday: vi.fn().mockResolvedValue({
        deckCount: 1,
        pending: [stored(1), stored(2, 'unblock'), stored(3, 'file')],
      }),
      isStale: vi.fn(async (card: StoredNowCard) => card.id === 'c1'),
    })

    const result = await resolveNow(deps)

    expect(deps.markSuperseded).toHaveBeenCalledTimes(1)
    expect(deps.markSuperseded).toHaveBeenCalledWith('c1')
    expect(deps.generate).not.toHaveBeenCalled()
    expect(result).toMatchObject({ state: 'card', card: { id: 'c2' }, remaining: 1 })
  })

  it('writes the next deck when every pending card turned out stale', async () => {
    const deps = makeDeps({
      readToday: vi.fn().mockResolvedValue({ deckCount: 1, pending: [stored(1), stored(2)] }),
      isStale: vi.fn().mockResolvedValue(true),
    })

    await resolveNow(deps)

    expect(deps.markSuperseded).toHaveBeenCalledTimes(2)
    expect(deps.writeDeck).toHaveBeenCalledWith(2, drafts, 12)
  })

  it('AC12: no candidates means clear, and no LLM call', async () => {
    const deps = makeDeps({
      loadCandidates: vi.fn().mockResolvedValue({ thoughts: [], projects: [], candidatesOmitted: 0 }),
    })

    await expect(resolveNow(deps)).resolves.toEqual({ state: 'clear' })

    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.writeDeck).not.toHaveBeenCalled()
  })

  it('AC13: three decks today and none pending means limit, with no candidate query and no LLM call', async () => {
    const deps = makeDeps({
      readToday: vi.fn().mockResolvedValue({ deckCount: NOW_DECKS_PER_DAY, pending: [] }),
    })

    await expect(resolveNow(deps)).resolves.toEqual({ state: 'limit' })

    expect(NOW_DECKS_PER_DAY).toBe(3)
    expect(deps.loadCandidates).not.toHaveBeenCalled()
    expect(deps.generate).not.toHaveBeenCalled()
  })

  it('AC11: when generation fails nothing is stored and the error reaches the caller', async () => {
    const deps = makeDeps({
      generate: vi.fn().mockRejectedValue(new Error('the model failed 3 times')),
    })

    await expect(resolveNow(deps)).rejects.toThrow(/3 times/)

    expect(deps.writeDeck).not.toHaveBeenCalled()
  })

  it('passes an insufficient-credits error through untouched', async () => {
    const noCredits = Object.assign(new Error('Not enough credits'), {
      name: 'InsufficientCreditsError',
    })
    const deps = makeDeps({ generate: vi.fn().mockRejectedValue(noCredits) })
    await expect(resolveNow(deps)).rejects.toBe(noCredits)
  })

  it('first writer wins: serves the deck another request stored, not its own', async () => {
    const deps = makeDeps({
      writeDeck: vi.fn().mockResolvedValue([stored(5, 'sort'), stored(6)]),
    })

    const result = await resolveNow(deps)

    expect(result).toMatchObject({ state: 'card', card: { id: 'c5', kind: 'sort' }, remaining: 1 })
  })
})

describe('buildNowCardRows (NOW-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async ({ plaintext }: { plaintext: string }) => `enc(${plaintext.length})`)
  })

  it('AC1: encrypts every payload under now_card/payload and keeps the text out of the row', async () => {
    const rows = await buildNowCardRows({
      userId: 'u1',
      day: '2026-11-09',
      deckNumber: 2,
      drafts,
      candidatesOmitted: 12,
    })

    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3])
    expect(rows[0]).toMatchObject({
      userId: 'u1',
      localDay: '2026-11-09',
      deckNumber: 2,
      kind: 'do',
      targetThoughtId: 'th-1',
      targetProjectEntityId: null,
    })
    expect(rows[1]).toMatchObject({ kind: 'unblock', targetThoughtId: null, targetProjectEntityId: 'pr-2' })
    for (const row of rows) {
      expect(row.payloadEncrypted).toMatch(/^enc\(/)
      expect(JSON.stringify(row)).not.toContain('Send the form')
      expect(JSON.stringify(row)).not.toContain('Book the site visit')
    }
    expect(encryptMock).toHaveBeenCalledTimes(3)
    expect(encryptMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', table: 'now_card', column: 'payload' }),
    )
    const plaintext = JSON.parse(encryptMock.mock.calls[1][0].plaintext)
    expect(plaintext).toEqual({
      text: 'Sewer has no next step.',
      why: 'Nothing is marked next.',
      suggestedStep: 'Book the site visit',
      notTaskCategory: null,
      candidatesOmitted: 12,
    })
  })
})

describe('writeNowDeck (one deck per number)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    encryptMock.mockImplementation(async () => 'enc')
  })

  /**
   * In-memory stand-in for the deck rows with Postgres semantics that matter here: the
   * advisory lock serialises transactions per key until the transaction ends, the unique key
   * (deck, position) skips conflicting rows, and every await yields so an unlocked
   * check-then-insert would interleave.
   */
  function fakeDeckDb() {
    const rows: Array<Record<string, unknown>> = []
    const locks = new Map<string, Promise<void>>()
    const lockKeys: string[] = []
    const yieldTick = () => new Promise((r) => setTimeout(r, 0))
    let txCount = 0

    const readChain = (result: () => unknown[]) => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => {
          await yieldTick()
          return result().slice(0, 1)
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      }
      return chain
    }

    const db = {
      select: () => readChain(() => [...rows].sort((a, b) => Number(a.position) - Number(b.position))),
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        txCount++
        let release!: () => void
        const held: string[] = []
        const tx = {
          execute: async (query: unknown) => {
            const q = new PgDialect().sqlToQuery(query as never)
            expect(q.sql).toContain('pg_advisory_xact_lock(hashtext(')
            const key = String(q.params[0])
            lockKeys.push(key)
            while (locks.has(key)) await locks.get(key)
            locks.set(
              key,
              new Promise<void>((r) => {
                release = () => {
                  locks.delete(key)
                  r()
                }
              }),
            )
            held.push(key)
            return []
          },
          select: () => readChain(() => rows),
          insert: () => ({
            values: async (batch: Array<Record<string, unknown>>) => {
              await yieldTick()
              for (const row of batch) {
                if (rows.some((r) => r.deckNumber === row.deckNumber && r.position === row.position)) {
                  throw new Error('duplicate key value violates unique constraint')
                }
                rows.push({ ...row, id: `id-${rows.length}`, status: 'pending' })
              }
            },
          }),
        }
        try {
          return await cb(tx)
        } finally {
          if (held.length) release()
        }
      },
    }
    getDbMock.mockReturnValue(db)
    return { rows, lockKeys, txCount: () => txCount }
  }

  const deckOf = (n: number): NowDeckDraft[] =>
    Array.from({ length: n }, (_, i) => ({ ...drafts[0], thoughtId: `th-${n}-${i}` }))

  it('two concurrent writes of different lengths for one deck number end with exactly one deck', async () => {
    const store = fakeDeckDb()

    const [a, b] = await Promise.all([
      writeNowDeck('u1', '2026-11-09', 1, deckOf(5), 0),
      writeNowDeck('u1', '2026-11-09', 1, deckOf(2), 0),
    ])

    const lengths = new Set(store.rows.map((r) => String(r.targetThoughtId).split('-')[1]))
    expect(lengths.size).toBe(1) // all rows come from one deck, never a mix
    expect(store.rows.length === 5 || store.rows.length === 2).toBe(true)
    expect(a).toHaveLength(store.rows.length)
    expect(b).toHaveLength(store.rows.length) // both callers serve the stored deck
    expect(store.lockKeys).toEqual(['now_card:u1:2026-11-09:1', 'now_card:u1:2026-11-09:1'])
  })

  it('does not insert when the deck number already has rows, and serves them', async () => {
    const store = fakeDeckDb()
    await writeNowDeck('u1', '2026-11-09', 1, deckOf(3), 0)
    const again = await writeNowDeck('u1', '2026-11-09', 1, deckOf(4), 0)
    expect(store.rows).toHaveLength(3)
    expect(again).toHaveLength(3)
  })

  it('runs the whole write inside one transaction', async () => {
    const store = fakeDeckDb()
    await writeNowDeck('u1', '2026-11-09', 1, deckOf(2), 0)
    expect(store.txCount()).toBe(1)
  })
})

describe('expireEarlierNowCards', () => {
  it('marks only this user\'s pending cards from earlier local days expired', async () => {
    const set = vi.fn()
    let where: unknown
    set.mockReturnValue({
      where: (cond: unknown) => {
        where = cond
        return Promise.resolve()
      },
    })
    getDbMock.mockReturnValue({ update: () => ({ set }) })

    await expireEarlierNowCards('u1', '2026-11-09')

    expect(set).toHaveBeenCalledWith({ status: 'expired' })
    const q = new PgDialect().sqlToQuery(where as never)
    expect(q.sql).toContain('"now_card"."user_id" = $')
    expect(q.sql).toContain('"now_card"."status" = $')
    expect(q.sql).toContain('"now_card"."local_day" < $')
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'pending', '2026-11-09']))
  })
})

describe('isNowCardStale (NOW-7 state check)', () => {
  function dbWith(rows: { thought?: unknown[]; project?: unknown[] }) {
    getDbMock.mockReturnValue({
      select: (fields: Record<string, unknown>) => {
        const result = 'nextActionLifecycle' in fields ? (rows.project ?? []) : (rows.thought ?? [])
        const chain: Record<string, unknown> = {
          from: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          limit: async () => result,
        }
        return chain
      },
    })
  }

  it('is fresh while the thought is open', async () => {
    dbWith({ thought: [{ lifecycleStatus: 'open' }] })
    await expect(isNowCardStale('u1', stored(1))).resolves.toBe(false)
  })

  it('is stale once the thought was completed, archived or removed', async () => {
    dbWith({ thought: [{ lifecycleStatus: 'completed' }] })
    await expect(isNowCardStale('u1', stored(1))).resolves.toBe(true)
    dbWith({ thought: [{ lifecycleStatus: 'archived' }] })
    await expect(isNowCardStale('u1', stored(1))).resolves.toBe(true)
    dbWith({ thought: [] })
    await expect(isNowCardStale('u1', stored(1))).resolves.toBe(true)
  })

  it('an unblock card is fresh while its active project still has no next action', async () => {
    dbWith({
      project: [{ status: 'active', nextActionThoughtId: null, nextActionLifecycle: null }],
    })
    await expect(isNowCardStale('u1', stored(2, 'unblock'))).resolves.toBe(false)
  })

  it('an unblock card is stale once the project has an open next action or is no longer active', async () => {
    dbWith({
      project: [{ status: 'active', nextActionThoughtId: 'n1', nextActionLifecycle: 'open' }],
    })
    await expect(isNowCardStale('u1', stored(2, 'unblock'))).resolves.toBe(true)
    dbWith({ project: [{ status: 'someday', nextActionThoughtId: null, nextActionLifecycle: null }] })
    await expect(isNowCardStale('u1', stored(2, 'unblock'))).resolves.toBe(true)
    dbWith({ project: [] })
    await expect(isNowCardStale('u1', stored(2, 'unblock'))).resolves.toBe(true)
  })

  it('a next action that was completed no longer counts as a next action', async () => {
    dbWith({
      project: [{ status: 'active', nextActionThoughtId: 'n1', nextActionLifecycle: 'completed' }],
    })
    await expect(isNowCardStale('u1', stored(2, 'unblock'))).resolves.toBe(false)
  })
})

describe('loadOtherActiveProjects', () => {
  it('selects only this user\'s active projects, never the proposed one, by label', async () => {
    let where: unknown
    let ordered = false
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: unknown) => {
        where = cond
        return chain
      },
      orderBy: async () => {
        ordered = true
        return [{ id: 'pr-8', label: 'Hydra' }]
      },
    }
    getDbMock.mockReturnValue({ select: () => chain })

    await expect(loadOtherActiveProjects('u1', 'pr-1')).resolves.toEqual([
      { id: 'pr-8', label: 'Hydra' },
    ])

    const q = new PgDialect().sqlToQuery(where as never)
    expect(q.sql).toContain('"canonical_entity"."user_id" = $')
    expect(q.sql).toContain('"canonical_entity"."project_status" = $')
    expect(q.sql).toContain('"canonical_entity"."id" <> $')
    expect(q.params).toEqual(expect.arrayContaining(['u1', 'active', 'pr-1']))
    expect(ordered).toBe(true)
  })

  it('without a proposed project there is nothing to exclude', async () => {
    let where: unknown
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (cond: unknown) => {
        where = cond
        return chain
      },
      orderBy: async () => [],
    }
    getDbMock.mockReturnValue({ select: () => chain })
    await loadOtherActiveProjects('u1', null)
    expect(new PgDialect().sqlToQuery(where as never).sql).not.toContain('<>')
  })
})
