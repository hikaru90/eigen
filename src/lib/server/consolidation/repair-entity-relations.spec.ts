import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InsufficientCreditsError } from '$lib/server/billing/wallet'
import { INGEST_MAX_RETRIES } from '$lib/server/ingest/retry'

const {
  getDbMock,
  fetchEntityEdgesForUserMock,
  extractEntityTriplesMock,
  upsertEntityRelationTriplesMock,
  upsertEntityRelationEdgeMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  fetchEntityEdgesForUserMock: vi.fn(),
  extractEntityTriplesMock: vi.fn(),
  upsertEntityRelationTriplesMock: vi.fn(),
  upsertEntityRelationEdgeMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/graph/age', () => ({
  fetchEntityEdgesForUser: fetchEntityEdgesForUserMock,
  upsertEntityRelationEdge: upsertEntityRelationEdgeMock,
  deleteEntityRelationEdge: vi.fn(),
}))
vi.mock('$lib/server/memory/entity-extraction', () => ({
  extractEntityTriples: extractEntityTriplesMock,
}))
vi.mock('$lib/server/memory/entity-graph-sync', () => ({
  upsertEntityRelationTriples: upsertEntityRelationTriplesMock,
}))
vi.mock('$lib/server/consolidation/prune-suspicious-entity-edges', () => ({
  pruneSuspiciousEntityEdgesForUser: vi.fn().mockResolvedValue({ scanned: 0, removed: 0 }),
}))

import {
  ENTITY_RELATION_REPAIR_MAX_ATTEMPTS,
  repairEntityRelationsForUser,
} from './repair-entity-relations'

function twoEntityRows(
  thoughtId: string,
  overrides?: { metadata?: Record<string, unknown> },
) {
  return [
    {
      thoughtId,
      canonicalEntityId: 'e-a',
      mentionSurface: 'A',
      label: 'A',
      canonicalKey: 'a',
      entityType: 'concept',
      normalizedText: 'A and B unrelated names',
      metadata: overrides?.metadata ?? {},
    },
    {
      thoughtId,
      canonicalEntityId: 'e-b',
      mentionSurface: 'B',
      label: 'B',
      canonicalKey: 'b',
      entityType: 'concept',
      normalizedText: 'A and B unrelated names',
      metadata: overrides?.metadata ?? {},
    },
  ]
}

function mockSelectWhere(rows: unknown[]) {
  getDbMock.mockReturnValue({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(async () => rows),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
  })
}

describe('repairEntityRelationsForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchEntityEdgesForUserMock.mockResolvedValue([])
    extractEntityTriplesMock.mockResolvedValue([])
    upsertEntityRelationTriplesMock.mockResolvedValue(0)
    upsertEntityRelationEdgeMock.mockResolvedValue(undefined)
  })

  it('uses the same max-attempt budget as ingest retries', () => {
    expect(ENTITY_RELATION_REPAIR_MAX_ATTEMPTS).toBe(INGEST_MAX_RETRIES)
    expect(ENTITY_RELATION_REPAIR_MAX_ATTEMPTS).toBe(3)
  })

  it('connects obvious prefix pairs when triple extraction returns nothing', async () => {
    mockSelectWhere([
      {
        thoughtId: 't1',
        canonicalEntityId: 'e-space',
        mentionSurface: 'Space',
        label: 'Space',
        canonicalKey: 'space',
        entityType: 'organization',
        normalizedText: 'Event at Space Hamburg in the Space network',
        metadata: {},
      },
      {
        thoughtId: 't1',
        canonicalEntityId: 'e-space-hamburg',
        mentionSurface: 'Space Hamburg',
        label: 'Space Hamburg',
        canonicalKey: 'space hamburg',
        entityType: 'place',
        normalizedText: 'Event at Space Hamburg in the Space network',
        metadata: {},
      },
    ])

    const result = await repairEntityRelationsForUser('u1')

    expect(result).toEqual({
      scanned: 1,
      gaps: 1,
      processed: 1,
      repaired: 1,
      edgesAdded: 1,
      skippedExhausted: 0,
      suspiciousEdgesRemoved: 0,
    })
    expect(upsertEntityRelationEdgeMock).toHaveBeenCalledWith({
      userId: 'u1',
      sourceEntityId: 'e-space-hamburg',
      targetEntityId: 'e-space',
      predicate: 'part_of',
    })
  })

  it('reports all connected when co-mentioned entities already share edges', async () => {
    mockSelectWhere(twoEntityRows('t1'))
    fetchEntityEdgesForUserMock.mockResolvedValue([
      { sourceId: 'e-a', targetId: 'e-b', weight: 1, predicate: 'related_to' },
    ])

    const result = await repairEntityRelationsForUser('u1')

    expect(result).toEqual({
      scanned: 1,
      gaps: 0,
      processed: 0,
      repaired: 0,
      edgesAdded: 0,
      skippedExhausted: 0,
      suspiciousEdgesRemoved: 0,
    })
    expect(extractEntityTriplesMock).not.toHaveBeenCalled()
    expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled()
  })

  it('skips thoughts that already exhausted max overnight repair attempts', async () => {
    mockSelectWhere(
      twoEntityRows('t1', {
        metadata: { entityRelationRepairAttempts: ENTITY_RELATION_REPAIR_MAX_ATTEMPTS },
      }),
    )

    const result = await repairEntityRelationsForUser('u1')

    expect(result.skippedExhausted).toBe(1)
    expect(result.processed).toBe(0)
    expect(extractEntityTriplesMock).not.toHaveBeenCalled()
  })

  it('increments attempt count after an LLM repair pass that does not close the gap', async () => {
    const updateSet = vi.fn(() => ({
      where: vi.fn(async () => undefined),
    }))
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(async () => twoEntityRows('t1', { metadata: { entityRelationRepairAttempts: 1 } })),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({ set: updateSet })),
    })
    extractEntityTriplesMock.mockResolvedValue([])

    await repairEntityRelationsForUser('u1')

    expect(extractEntityTriplesMock).toHaveBeenCalledTimes(1)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ entityRelationRepairAttempts: 2 }),
      }),
    )
  })

  it('aborts the overnight batch immediately on InsufficientCreditsError', async () => {
    mockSelectWhere([...twoEntityRows('t1'), ...twoEntityRows('t2')])
    extractEntityTriplesMock
      .mockRejectedValueOnce(
        new InsufficientCreditsError({ availableCredits: 0, requiredCredits: 1 }),
      )
      .mockResolvedValue([])

    await expect(repairEntityRelationsForUser('u1')).rejects.toBeInstanceOf(InsufficientCreditsError)

    expect(extractEntityTriplesMock).toHaveBeenCalledTimes(1)
  })

  it('counts a non-billing LLM failure as one attempt and continues other thoughts', async () => {
    const updateSet = vi.fn(() => ({
      where: vi.fn(async () => undefined),
    }))
    getDbMock.mockReturnValue({
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            innerJoin: vi.fn(() => ({
              where: vi.fn(async () => [...twoEntityRows('t1'), ...twoEntityRows('t2')]),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({ set: updateSet })),
    })
    extractEntityTriplesMock
      .mockRejectedValueOnce(new Error('gateway timeout'))
      .mockResolvedValue([])

    const result = await repairEntityRelationsForUser('u1')

    expect(extractEntityTriplesMock).toHaveBeenCalledTimes(2)
    expect(result.processed).toBe(2)
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ entityRelationRepairAttempts: 1 }),
      }),
    )
  })
})
