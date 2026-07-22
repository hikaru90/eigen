import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchTemporalEventSeedsForHints,
  filterTemporalEvents,
  inferQueryTimeRange,
  isTemporalQuery,
  resolveQueryTimeRange,
  traverseTemporalContext,
} from './temporal'

const {
  getDbMock,
  createThoughtEmbeddingMock,
  createThoughtEmbeddingsMock,
  expandContextFromTemporalEventSeedsMock,
  resolveTemporalHintBindingsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  createThoughtEmbeddingsMock: vi.fn(),
  expandContextFromTemporalEventSeedsMock: vi.fn(),
  resolveTemporalHintBindingsMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/embedding', () => ({
  createThoughtEmbedding: createThoughtEmbeddingMock,
  createThoughtEmbeddings: createThoughtEmbeddingsMock,
}))
vi.mock('$lib/server/graph/age', () => ({
  expandContextFromTemporalEventSeeds: expandContextFromTemporalEventSeedsMock,
}))
vi.mock('$lib/server/retrieval/resolve-temporal-hint-bindings', () => ({
  resolveTemporalHintBindings: resolveTemporalHintBindingsMock,
  candidatesFromTemporalSeeds: (
    seeds: Array<{
      eventId: string
      thoughtId: string
      semanticSummary: string
      startAt: Date | null
      kind: string
    }>,
  ) =>
    seeds.map((seed) => ({
      eventId: seed.eventId,
      thoughtId: seed.thoughtId,
      semanticSummary: seed.semanticSummary,
      startAt: seed.startAt?.toISOString() ?? null,
      kind: seed.kind,
    })),
}))

describe('isTemporalQuery', () => {
  it('returns true when LLM intent marks temporal', () => {
    expect(isTemporalQuery({ temporal: true, kind: 'ordering', timeWindow: null })).toBe(true)
  })

  it('returns false when intent is absent or non-temporal', () => {
    expect(isTemporalQuery(null)).toBe(false)
    expect(isTemporalQuery({ temporal: false, kind: 'none', timeWindow: null })).toBe(false)
  })
})

describe('resolveQueryTimeRange', () => {
  it('returns time window from LLM intent', () => {
    const window = {
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: new Date('2026-06-01T00:00:00.000Z'),
    }
    expect(resolveQueryTimeRange({ temporal: true, kind: 'absolute', timeWindow: window })).toEqual(
      window,
    )
  })

  it('returns null when intent has no window', () => {
    expect(resolveQueryTimeRange({ temporal: true, kind: 'ordering', timeWindow: null })).toBeNull()
  })
})

describe('inferQueryTimeRange', () => {
  it('always returns null — query time windows come from LLM intent', () => {
    expect(inferQueryTimeRange('events in 2026')).toBeNull()
  })
})

describe('filterTemporalEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
  })

  it('returns ranked temporal events from Postgres', async () => {
    const limit = vi.fn(async () => [
      {
        id: 'ev1',
        graphNodeId: 'node-1',
        semanticSummary: 'Team offsite',
        thoughtId: 't1',
        distance: 0.2,
      },
    ])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })

    const rows = await filterTemporalEvents({
      userId: 'u1',
      query: 'events in May 2026',
      queryEmbedding: [0.5, 0.6],
    })

    expect(rows).toEqual([
      expect.objectContaining({
        eventId: 'ev1',
        thoughtId: 't1',
        score: 1,
      }),
    ])
    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
  })

  it('embeds the query and applies an inferred time range when none is supplied', async () => {
    const limit = vi.fn(async () => [
      {
        id: 'ev1',
        graphNodeId: null,
        semanticSummary: 'May planning session',
        thoughtId: 't1',
        distance: 0.1,
      },
    ])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })
    createThoughtEmbeddingMock.mockResolvedValue([0.3, 0.4])

    const rows = await filterTemporalEvents({
      userId: 'u1',
      query: 'events in May 2026',
    })

    expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'events in May 2026')
    expect(rows[0]?.eventId).toBe('ev1')
    expect(rows[0]?.graphNodeId).toBeNull()
  })

  it('uses explicit queryRange without inferring from text', async () => {
    const limit = vi.fn(async () => [])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })

    await filterTemporalEvents({
      userId: 'u1',
      query: 'any query',
      queryEmbedding: [0.1, 0.2],
      queryRange: {
        start: new Date('2026-05-01T00:00:00.000Z'),
        end: new Date('2026-06-01T00:00:00.000Z'),
      },
    })

    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
  })

  it('searches without a time-range filter when no window can be inferred', async () => {
    const limit = vi.fn(async () => [])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })

    await filterTemporalEvents({
      userId: 'u1',
      query: 'random thoughts about bread',
      queryEmbedding: [0.1, 0.2],
    })

    expect(where).toHaveBeenCalled()
    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
  })

  it('honors an explicit null queryRange override', async () => {
    const limit = vi.fn(async () => [])
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })

    await filterTemporalEvents({
      userId: 'u1',
      query: 'events in May 2026',
      queryEmbedding: [0.1, 0.2],
      queryRange: null,
    })

    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
  })
})

describe('traverseTemporalContext', () => {
  it('returns [] when seeds have no ids', async () => {
    await expect(
      traverseTemporalContext({
        userId: 'u1',
        seeds: [],
      }),
    ).resolves.toEqual([])
  })

  it('delegates to AGE graph expansion for seeded events', async () => {
    expandContextFromTemporalEventSeedsMock.mockResolvedValue([
      { thoughtId: 't1', hits: 2, provenance: 'temporal' },
    ])

    const rows = await traverseTemporalContext({
      userId: 'u1',
      seeds: [
        {
          eventId: 'ev1',
          graphNodeId: 'node-1',
          semanticSummary: 'Meeting',
          thoughtId: 't1',
          score: 1,
        },
      ],
    })

    expect(expandContextFromTemporalEventSeedsMock).toHaveBeenCalledWith({
      userId: 'u1',
      eventIds: ['node-1'],
      limit: 40,
    })
    expect(rows).toHaveLength(1)
  })

  it('falls back to eventId when graphNodeId is missing', async () => {
    expandContextFromTemporalEventSeedsMock.mockResolvedValue([])

    await traverseTemporalContext({
      userId: 'u1',
      seeds: [
        {
          eventId: 'ev-only',
          graphNodeId: null,
          semanticSummary: 'Meeting',
          thoughtId: 't1',
          score: 1,
        },
      ],
    })

    expect(expandContextFromTemporalEventSeedsMock).toHaveBeenCalledWith({
      userId: 'u1',
      eventIds: ['ev-only'],
      limit: 40,
    })
  })
})

describe('fetchTemporalEventSeedsForHints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
    createThoughtEmbeddingsMock.mockImplementation(async (userId: string, inputs: string[]) =>
      Promise.all(inputs.map((input) => createThoughtEmbeddingMock(userId, input))),
    )
    resolveTemporalHintBindingsMock.mockResolvedValue([
      { hint: 'bike', eventId: 'ev-bike', thoughtId: 't-bike' },
      { hint: 'car', eventId: 'ev-car', thoughtId: 't-car' },
    ])
  })

  it('merges per-hint results so both anchors are retained', async () => {
    const bikeRow = {
      id: 'ev-bike',
      thoughtId: 't-bike',
      semanticSummary: 'Bike repairs in mid-February',
      startAt: new Date('2023-02-15T00:00:00.000Z'),
      activePeriod: '[2023-02-15,2023-02-16)',
      kind: 'milestone' as const,
      distance: 0.1,
    }
    const carRow = {
      id: 'ev-car',
      thoughtId: 't-car',
      semanticSummary: 'Car wash for Toyota Corolla on February 27th',
      startAt: new Date('2023-02-27T00:00:00.000Z'),
      activePeriod: '[2023-02-27,2023-02-28)',
      kind: 'milestone' as const,
      distance: 0.5,
    }
    const decoys = Array.from({ length: 50 }, (_, i) => ({
      id: `ev-decoy-${i}`,
      thoughtId: `t-decoy-${i}`,
      semanticSummary: `Unrelated event ${i}`,
      startAt: new Date('2023-01-01T00:00:00.000Z'),
      activePeriod: '[2023-01-01,2023-01-02)',
      kind: 'inferred_event' as const,
      distance: 0.2 + i * 0.01,
    }))

    let call = 0
    const limit = vi.fn(async () => {
      call++
      if (call === 1) return decoys
      if (call === 2) return [bikeRow, ...decoys.slice(0, 5)]
      return [carRow, ...decoys.slice(0, 5)]
    })
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })

    const result = await fetchTemporalEventSeedsForHints({
      userId: 'u1',
      query: 'Which vehicle did I take care of first in February, the bike or the car?',
      queryEmbedding: [0.5, 0.6],
      entityHints: ['bike', 'car'],
      limit: 24,
      limitPerHint: 8,
    })

    const thoughtIds = result.seeds.map((s) => s.thoughtId)
    expect(thoughtIds).toContain('t-bike')
    expect(thoughtIds).toContain('t-car')
    expect(resolveTemporalHintBindingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Which vehicle did I take care of first in February, the bike or the car?',
        kind: 'none',
      }),
    )
  })

  it('runs per-hint embedding search for a single entity hint', async () => {
    const airbnbRow = {
      id: 'ev-airbnb',
      thoughtId: 't-airbnb',
      semanticSummary: 'Booked Airbnb in Haight-Ashbury for wedding',
      startAt: new Date('2022-12-27T00:00:00.000Z'),
      activePeriod: '[2022-12-27,2022-12-28)',
      kind: 'milestone' as const,
      distance: 0.1,
    }
    const decoys = Array.from({ length: 20 }, (_, i) => ({
      id: `ev-decoy-${i}`,
      thoughtId: `t-decoy-${i}`,
      semanticSummary: `Unrelated event ${i}`,
      startAt: new Date('2023-01-01T00:00:00.000Z'),
      activePeriod: '[2023-01-01,2023-01-02)',
      kind: 'inferred_event' as const,
      distance: 0.2 + i * 0.01,
    }))

    let call = 0
    const limit = vi.fn(async () => {
      call++
      if (call === 1) return decoys
      return [airbnbRow, ...decoys.slice(0, 3)]
    })
    const orderBy = vi.fn(() => ({ limit }))
    const where = vi.fn(() => ({ orderBy }))
    const from = vi.fn(() => ({ where }))
    getDbMock.mockReturnValue({ select: vi.fn(() => ({ from })) })
    resolveTemporalHintBindingsMock.mockResolvedValue([
      { hint: 'Airbnb in San Francisco', eventId: 'ev-airbnb', thoughtId: 't-airbnb' },
    ])

    const result = await fetchTemporalEventSeedsForHints({
      userId: 'u1',
      query: 'How many months ago did I book the Airbnb in San Francisco?',
      queryEmbedding: [0.5, 0.6],
      entityHints: ['Airbnb in San Francisco'],
      kind: 'lookback',
      limit: 24,
    })

    expect(createThoughtEmbeddingsMock).toHaveBeenCalledWith('u1', ['Airbnb in San Francisco'])
    expect(result.seeds.map((s) => s.thoughtId)).toContain('t-airbnb')
    expect(result.candidatesByHint).toHaveLength(1)
  })
})
