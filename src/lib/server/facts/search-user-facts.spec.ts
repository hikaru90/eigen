import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  factSearchConditions,
  rankFactCandidates,
  runFactSearch,
  type FactRow,
  type FactSearchSources,
} from './search-user-facts'

const T1 = '11111111-1111-4111-8111-111111111111'
const FILE1 = '22222222-2222-4222-8222-222222222222'

function row(id: string, over: Partial<FactRow> = {}): FactRow {
  return {
    id,
    subjectKind: 'user',
    subjectLabel: null,
    subjectEntityId: null,
    statementEncrypted: `enc:${id}`,
    kind: 'activity',
    confidence: 0.9,
    inferred: false,
    status: 'active',
    supersededBy: null,
    asOf: new Date('2026-05-01T00:00:00Z'),
    secureValueId: null,
    ...over,
  }
}

function sources(
  candidates: Array<{ factId: string; vectorDistance?: number; lexicalRank?: number }>,
  rows: FactRow[],
  provenance: Array<{ factId: string; thoughtId: string | null; textFileId: string | null }> = [],
): FactSearchSources {
  return {
    candidates: async () => candidates,
    loadFacts: async (ids) => rows.filter((r) => ids.includes(r.id)),
    loadSources: async (ids) => provenance.filter((p) => ids.includes(p.factId)),
    decryptStatement: async (r) => `statement of ${r.id}`,
  }
}

describe('rankFactCandidates', () => {
  it('scores a fact by its best signal: cosine similarity or the normalised keyword rank', () => {
    const ranked = rankFactCandidates(
      [
        { factId: 'a', vectorDistance: 0.3 },
        { factId: 'b', lexicalRank: 0.3 },
        { factId: 'c', vectorDistance: 0.9 },
      ],
      { minScore: 0.22, limit: 10 },
    )
    // a: 1 - 0.3 = 0.7 · b: 0.3 * 2.5 = 0.75 · c: 0.1 (under the floor)
    expect(ranked.map((r) => r.factId)).toEqual(['b', 'a'])
    expect(ranked[0]!.score).toBeCloseTo(0.75)
    expect(ranked[1]!.vectorScore).toBeCloseTo(0.7)
  })

  it('merges the vector and the keyword row of one fact', () => {
    const ranked = rankFactCandidates(
      [
        { factId: 'a', vectorDistance: 0.6 },
        { factId: 'a', lexicalRank: 0.4 },
      ],
      { minScore: 0.22, limit: 10 },
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0]!.score).toBeCloseTo(1)
  })

  it('keeps at most `limit` facts, best first, ties by id', () => {
    const ranked = rankFactCandidates(
      [
        { factId: 'b', vectorDistance: 0.2 },
        { factId: 'a', vectorDistance: 0.2 },
        { factId: 'c', vectorDistance: 0.1 },
      ],
      { minScore: 0, limit: 2 },
    )
    expect(ranked.map((r) => r.factId)).toEqual(['c', 'a'])
  })
})

describe('runFactSearch', () => {
  it('returns decrypted statements with subject, kind, as-of, inferred and provenance ids — in score order', async () => {
    const hits = await runFactSearch(
      sources(
        [
          { factId: 'low', vectorDistance: 0.5 },
          { factId: 'high', vectorDistance: 0.1 },
        ],
        [
          row('low'),
          row('high', {
            subjectKind: 'person',
            subjectLabel: 'Mia (friend)',
            subjectEntityId: 'e1',
            kind: 'health',
            inferred: true,
          }),
        ],
        [
          { factId: 'high', thoughtId: T1, textFileId: FILE1 },
          { factId: 'high', thoughtId: null, textFileId: FILE1 },
        ],
      ),
      { minScore: 0.22, limit: 5 },
    )
    expect(hits.map((h) => h.id)).toEqual(['high', 'low'])
    expect(hits[0]).toEqual({
      id: 'high',
      subjectKind: 'person',
      subjectLabel: 'Mia (friend)',
      subjectEntityId: 'e1',
      statement: 'statement of high',
      kind: 'health',
      inferred: true,
      confidence: 0.9,
      status: 'active',
      supersededBy: null,
      asOf: new Date('2026-05-01T00:00:00Z'),
      secureValueId: null,
      sourceThoughtIds: [T1],
      sourceTextFileIds: [FILE1],
      score: expect.closeTo(0.9),
      vectorScore: expect.closeTo(0.9),
    })
  })

  it('never returns an embedding or a secure value: only the reference id', async () => {
    const hits = await runFactSearch(
      sources(
        [{ factId: 'plate', vectorDistance: 0.1 }],
        [row('plate', { secureValueId: 'sv-1', kind: 'circumstance' })],
      ),
      { minScore: 0.22, limit: 5 },
    )
    const keys = Object.keys(hits[0]!)
    expect(keys.some((k) => /embedding|vector$|value$/i.test(k) && k !== 'secureValueId')).toBe(
      false,
    )
    expect(JSON.stringify(hits[0])).not.toMatch(/embedding/i)
    expect(hits[0]!.secureValueId).toBe('sv-1')
  })

  it('does not look anything up when no candidate clears the floor', async () => {
    let loaded = false
    const hits = await runFactSearch(
      {
        ...sources([{ factId: 'x', vectorDistance: 0.95 }], [row('x')]),
        loadFacts: async () => {
          loaded = true
          return []
        },
      },
      { minScore: 0.22, limit: 5 },
    )
    expect(hits).toEqual([])
    expect(loaded).toBe(false)
  })

  it('drops a candidate whose row is gone or no longer matches (forgotten between the two reads)', async () => {
    const hits = await runFactSearch(
      sources(
        [
          { factId: 'kept', vectorDistance: 0.1 },
          { factId: 'gone', vectorDistance: 0.1 },
        ],
        [row('kept')],
      ),
      { minScore: 0.22, limit: 5 },
    )
    expect(hits.map((h) => h.id)).toEqual(['kept'])
  })
})

describe('factSearchConditions: a forgotten or superseded fact never matches', () => {
  const dialect = new PgDialect()
  const render = (statuses: Array<'active' | 'superseded'>, extra: { asOfBefore?: Date } = {}) =>
    dialect.sqlToQuery(factSearchConditions('u1', { statuses, ...extra }))

  it('filters on the tenant and on the allowed statuses only', () => {
    const { sql, params } = render(['active'])
    expect(sql).toContain('"user_fact"."user_id" = $1')
    expect(sql).toContain('"user_fact"."status"')
    expect(params).toContain('u1')
    expect(params).toContain('active')
    expect(params).not.toContain('forgotten')
    expect(params).not.toContain('superseded')
  })

  it('history searches add superseded, still never forgotten', () => {
    const { params } = render(['active', 'superseded'])
    expect(params).toEqual(expect.arrayContaining(['active', 'superseded']))
    expect(params).not.toContain('forgotten')
  })

  it('can restrict to facts known before a point in time', () => {
    const { sql } = render(['active'], { asOfBefore: new Date('2026-06-02T10:00:00.000Z') })
    expect(sql).toContain('"user_fact"."as_of" <')
  })
})
