import { describe, expect, it, vi } from 'vitest'
import { appDbAsyncLocal } from '$lib/server/db/context'
import {
  computeRetrievalQualityDiagnostics,
  isGraphOnlyHit,
  semanticShare,
  RETRIEVAL_TELEMETRY_VERSION,
  tryRecordRetrievalQualityEvent,
} from './quality-telemetry'

describe('semanticShare / isGraphOnlyHit', () => {
  it('computes semantic share from vector and graph RRF contributions', () => {
    expect(semanticShare({ vectorScore: 0.7, graphScore: 0.3 })).toBeCloseTo(0.7 / 1.0)
    expect(semanticShare({ vectorScore: 0, graphScore: 0.5 })).toBe(0)
  })

  it('treats graph-only when vector contribution is zero', () => {
    expect(isGraphOnlyHit({ vectorScore: 0, graphScore: 0.02 })).toBe(true)
    expect(isGraphOnlyHit({ vectorScore: 1e-9, graphScore: 0.02 })).toBe(false)
  })
})

describe('computeRetrievalQualityDiagnostics', () => {
  it('returns zeros for empty results but preserves requested topK and weights', () => {
    const d = computeRetrievalQualityDiagnostics([], { vector: 0.7, graph: 0.3 }, 12)
    expect(d.resultCount).toBe(0)
    expect(d.topKRequested).toBe(12)
    expect(d.top1SemanticShare).toBe(0)
    expect(d.topkMeanSemanticShare).toBe(0)
    expect(d.top1PrimaryChannel).toBe('semantic')
    expect(d.graphOnlyInTopkCount).toBe(0)
    expect(d.weightVector).toBe(0.7)
    expect(d.weightGraph).toBe(0.3)
  })

  it('aggregates top-1 channel and graph-only counts', () => {
    const rows = [
      { vectorScore: 0.08, graphScore: 0.01 },
      { vectorScore: 0, graphScore: 0.05 },
      { vectorScore: 0.02, graphScore: 0.02 },
    ]
    const d = computeRetrievalQualityDiagnostics(rows, { vector: 1, graph: 0 }, 20)
    expect(d.topKRequested).toBe(20)
    expect(d.resultCount).toBe(3)
    expect(d.top1PrimaryChannel).toBe('semantic')
    expect(d.graphOnlyInTopkCount).toBe(1)
    expect(d.topkMeanSemanticShare).toBeGreaterThan(0)
  })
})

describe('tryRecordRetrievalQualityEvent', () => {
  it('does nothing when no app DB scope is active', async () => {
    await expect(
      tryRecordRetrievalQualityEvent({
        userId: 'u1',
        surface: 'api',
        weights: { vector: 0.7, graph: 0.3 },
        topKRequested: 3,
        results: [{ vectorScore: 0.1, graphScore: 0.02 }],
      }),
    ).resolves.toBeUndefined()
  })

  it('swallows insert failures without throwing', async () => {
    const fakeDb = {
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.reject(new Error('insert failed'))),
      })),
    }
    await appDbAsyncLocal.run(fakeDb as never, async () => {
      await tryRecordRetrievalQualityEvent({
        userId: 'u1',
        surface: 'mcp',
        weights: { vector: 0.7, graph: 0.3 },
        topKRequested: 2,
        results: [{ vectorScore: 0.05, graphScore: 0.01 }],
      })
    })
    expect(fakeDb.insert).toHaveBeenCalled()
  })

  it('persists when insert succeeds', async () => {
    const values = vi.fn(() => Promise.resolve(undefined))
    const fakeDb = {
      insert: vi.fn(() => ({ values })),
    }
    await appDbAsyncLocal.run(fakeDb as never, async () => {
      await tryRecordRetrievalQualityEvent({
        userId: 'u1',
        surface: 'compose_answer',
        weights: { vector: 0.7, graph: 0.3 },
        topKRequested: 4,
        results: [],
      })
    })
    expect(values).toHaveBeenCalled()
  })
})
