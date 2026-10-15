import type { DecisionShadowRowInput } from './decision-shadow-query'
import { describe, expect, it, vi } from 'vitest'
import { loadDecisionShadowSummary, summarizeShadowRows } from './decision-shadow-query'

function row(overrides: Partial<DecisionShadowRowInput> = {}): DecisionShadowRowInput {
  return {
    id: 'r1',
    createdAt: '2026-01-01T10:00:00.000Z',
    surface: 'capture_service',
    decisionKind: 'category',
    llmChoice: 'task',
    llmConfidence: 0.8,
    decisionChoice: 'task',
    decisionProbability: 0.9,
    agree: true,
    decisionError: null,
    decisionDurationMs: 40,
    authoritativeEngine: 'chat_judge',
    ...overrides,
  }
}

describe('summarizeShadowRows', () => {
  it('returns zeroed summary with null agreementRate when there are no rows', () => {
    const result = summarizeShadowRows([])
    expect(result.summary).toEqual({
      total: 0,
      compared: 0,
      agreed: 0,
      disagreed: 0,
      errored: 0,
      agreementRate: null,
    })
    expect(result.kinds).toEqual([])
    expect(result.confusionPairs).toEqual([])
  })

  it('computes agreement over comparable pairs only (errors excluded)', () => {
    const result = summarizeShadowRows([
      row(),
      row({ id: 'r2', agree: true }),
      row({ id: 'r3', agree: false, decisionChoice: 'idea' }),
      row({ id: 'r4', agree: null, decisionChoice: null, decisionError: '401' }),
    ])
    expect(result.summary).toEqual({
      total: 4,
      compared: 3,
      agreed: 2,
      disagreed: 1,
      errored: 1,
      agreementRate: 2 / 3,
    })
  })

  it('summarizes per decision kind (AC-S1-1 read model)', () => {
    const result = summarizeShadowRows([
      row({ id: 'c1', decisionKind: 'category', agree: true }),
      row({ id: 'c2', decisionKind: 'category', agree: false, decisionChoice: 'idea' }),
      row({ id: 'e1', decisionKind: 'entity_type', llmChoice: 'person', decisionChoice: 'person', agree: true }),
      row({ id: 'e2', decisionKind: 'entity_type', llmChoice: 'person', agree: null, decisionChoice: null, decisionError: 'timeout' }),
    ])
    expect(result.kinds).toEqual([
      {
        decisionKind: 'category',
        total: 2,
        compared: 2,
        agreed: 1,
        disagreed: 1,
        errored: 0,
        agreementRate: 0.5,
        authoritativeEngine: 'chat_judge',
      },
      {
        decisionKind: 'entity_type',
        total: 2,
        compared: 1,
        agreed: 1,
        disagreed: 0,
        errored: 1,
        agreementRate: 1,
        authoritativeEngine: 'chat_judge',
      },
    ])
  })

  it('a successful authoritative answer with no chat primary is neither compared nor errored (chat skipped)', () => {
    const result = summarizeShadowRows([
      row({
        id: 's1',
        llmChoice: null,
        llmConfidence: null,
        decisionChoice: 'thought_only',
        decisionProbability: 0.8,
        agree: null,
        decisionError: null,
        authoritativeEngine: 'decision_model',
      }),
    ])
    expect(result.summary).toEqual({
      total: 1,
      compared: 0,
      agreed: 0,
      disagreed: 0,
      errored: 0,
      agreementRate: null,
    })
    expect(result.kinds[0]).toMatchObject({
      decisionKind: 'category',
      errored: 0,
      authoritativeEngine: 'decision_model',
    })
  })

  it('reports the latest authoritative engine per kind', () => {
    const result = summarizeShadowRows([
      row({ id: 'old', createdAt: '2026-01-01T10:00:00.000Z', authoritativeEngine: 'chat_judge' }),
      row({ id: 'new', createdAt: '2026-01-02T10:00:00.000Z', authoritativeEngine: 'decision_model' }),
    ])
    expect(result.kinds[0]?.authoritativeEngine).toBe('decision_model')
  })

  it('counts disagreement pairs per kind (kind + llm choice → shadow choice) ordered by frequency', () => {
    const result = summarizeShadowRows([
      row({ id: 'r1', agree: false, decisionKind: 'category', llmChoice: 'task', decisionChoice: 'idea' }),
      row({ id: 'r2', agree: false, decisionKind: 'category', llmChoice: 'task', decisionChoice: 'idea' }),
      row({ id: 'r3', agree: false, decisionKind: 'entity_type', llmChoice: 'person', decisionChoice: 'technology' }),
      row({ id: 'r4', agree: true }),
    ])
    expect(result.confusionPairs).toEqual([
      { decisionKind: 'category', llmChoice: 'task', decisionChoice: 'idea', count: 2 },
      { decisionKind: 'entity_type', llmChoice: 'person', decisionChoice: 'technology', count: 1 },
    ])
  })

  it('sorts recent rows newest first and applies the limit', () => {
    const rows = [2, 1, 3].map((i) =>
      row({ id: `r${i}`, createdAt: `2026-01-0${i}T10:00:00.000Z` }),
    )
    const result = summarizeShadowRows(rows, 2)
    expect(result.recent.map((r) => r.id)).toEqual(['r3', 'r2'])
  })
})

describe('loadDecisionShadowSummary', () => {
  function makeDb() {
    const kindRows = [
      { decisionKind: 'category', total: 4, compared: 3, agreed: 2, disagreed: 1, errored: 1, authoritativeEngine: 'decision_model' },
      { decisionKind: 'entity_type', total: 2, compared: 2, agreed: 2, disagreed: 0, errored: 0, authoritativeEngine: 'chat_judge' },
    ]
    const recentRows = [
      // drizzle revives timestamp columns to Date; the loader serializes to ISO.
      { ...row(), createdAt: new Date('2026-01-01T10:00:00.000Z') },
    ]
    const confusionRows = [
      { decisionKind: 'category', llmChoice: 'task', decisionChoice: 'idea', count: 1 },
    ]

    return {
      select: vi.fn((fields: Record<string, unknown>) => {
        // Per-kind aggregate query vs confusion-pair vs recent-row queries.
        if ('decisionKind' in fields && 'total' in fields) {
          return {
            from: () => ({
              where: () => ({
                groupBy: async () => kindRows,
              }),
            }),
          }
        }
        if ('count' in fields) {
          return {
            from: () => ({
              where: () => ({
                groupBy: () => ({
                  orderBy: () => ({
                    limit: async () => confusionRows,
                  }),
                }),
              }),
            }),
          }
        }
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => recentRows,
              }),
            }),
          }),
        }
      }),
    }
  }

  it('runs kind-aggregate, confusion, and recent queries and derives the aggregate view', async () => {
    const db = makeDb()
    const view = await loadDecisionShadowSummary(db as never, 'user-1')

    // Aggregate headline derived from per-kind rows: 6 total, 5 compared, 4 agreed.
    expect(view.summary).toEqual({
      total: 6,
      compared: 5,
      agreed: 4,
      disagreed: 1,
      errored: 1,
      agreementRate: 4 / 5,
    })
    expect(view.kinds).toHaveLength(2)
    expect(view.kinds[0]?.decisionKind).toBe('category')
    expect(view.kinds[0]?.agreementRate).toBeCloseTo(2 / 3)
    expect(view.confusionPairs).toHaveLength(1)
    expect(view.recent).toHaveLength(1)
    expect(view.recent[0]?.createdAt).toBe('2026-01-01T10:00:00.000Z')
  })
})
