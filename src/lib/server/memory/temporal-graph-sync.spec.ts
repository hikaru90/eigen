import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncTemporalEventsFromThought } from './temporal-graph-sync'

const {
  extractTemporalMentionsMock,
  createThoughtEmbeddingMock,
  processPendingGraphSyncJobsMock,
  getDbMock,
  resolveEnforceKindsMock,
  runEnforcedPerItemDecisionsMock,
} = vi.hoisted(() => ({
  extractTemporalMentionsMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  processPendingGraphSyncJobsMock: vi.fn(),
  getDbMock: vi.fn(),
  resolveEnforceKindsMock: vi.fn(),
  runEnforcedPerItemDecisionsMock: vi.fn(),
}))

vi.mock('$lib/server/memory/temporal-extraction', () => ({
  extractTemporalMentions: extractTemporalMentionsMock,
}))
vi.mock('$lib/server/llm/embedding', () => ({
  createThoughtEmbedding: createThoughtEmbeddingMock,
}))
vi.mock('$lib/server/graph/graph-sync-worker', () => ({
  processPendingGraphSyncJobs: processPendingGraphSyncJobsMock,
}))
vi.mock('$lib/server/db', () => ({
  getDb: getDbMock,
}))
// Enforcement is controlled through resolveDecisionEnforceKinds (same pattern as
// enrich-queued-thought.spec.ts): under vitest SvelteKit's $env/dynamic/private is
// a transform-time snapshot, so process.env stubs never reach the real resolver.
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return { ...actual, resolveDecisionEnforceKinds: resolveEnforceKindsMock }
})
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedPerItemDecisions: runEnforcedPerItemDecisionsMock }
})

const sampleMention = {
  surface: 'due Friday',
  kind: 'deadline' as const,
  startAt: '2026-05-22T00:00:00.000Z',
  timePrecision: 'day' as const,
  timezone: 'UTC',
  isAllDay: true,
  confidence: 0.9,
  semanticSummary: 'Report due Friday',
}

function makeDb(existingRows: Array<{ id: string; graphNodeId: string | null }> = []) {
  const deleteWhere = vi.fn(async () => undefined)
  const deleteFn = vi.fn(() => ({ where: deleteWhere }))

  const insertReturning = vi.fn()
  const insertValues = vi.fn(() => ({ returning: insertReturning }))
  const insertFn = vi.fn(() => ({ values: insertValues }))

  const authorshipRow = { author: 'user', authorLabel: null, authorKeyId: null }
  /** First select is thought authorship (.limit); later selects await where for temporal rows. */
  const selectWhere = vi.fn(() => ({
    limit: vi.fn(async () => [authorshipRow]),
    then(onFulfilled?: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
      return Promise.resolve(existingRows).then(onFulfilled, onRejected)
    },
  }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const selectFn = vi.fn(() => ({ from: selectFrom }))

  const tx = {
    delete: deleteFn,
    insert: insertFn,
  }

  return {
    select: selectFn,
    delete: deleteFn,
    insert: insertFn,
    transaction: vi.fn(async (cb: (tx: typeof tx) => unknown) => cb(tx)),
    insertReturning,
    insertValues,
    deleteWhere,
    selectWhere,
  }
}

/** temporalEvent rows are the insert calls carrying parseMetadata (graphSyncJob rows do not). */
function temporalInsertValues(db: ReturnType<typeof makeDb>): Array<Record<string, unknown>> {
  return db.insertValues.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((values) => values && typeof values === 'object' && 'parseMetadata' in values)
}

describe('syncTemporalEventsFromThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    processPendingGraphSyncJobsMock.mockResolvedValue(undefined)
    createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
    resolveEnforceKindsMock.mockReturnValue(new Set())
    runEnforcedPerItemDecisionsMock.mockResolvedValue(new Map())
  })

  it('returns early when extraction finds no temporal mentions', async () => {
    const db = makeDb()
    getDbMock.mockReturnValue(db)
    extractTemporalMentionsMock.mockResolvedValue([])

    await syncTemporalEventsFromThought({
      userId: 'u1',
      thoughtId: 't1',
      normalizedText: 'plain note',
    })

    expect(extractTemporalMentionsMock).toHaveBeenCalled()
    expect(db.transaction).not.toHaveBeenCalled()
    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
  })

  it('deletes existing temporal rows and enqueues graph deletes before inserting new mentions', async () => {
    const db = makeDb([{ id: 'ev-old', graphNodeId: 'node-1' }])
    getDbMock.mockReturnValue(db)
    extractTemporalMentionsMock.mockResolvedValue([sampleMention])

    db.insertReturning
      .mockResolvedValueOnce([{ id: 'ev-new' }])
      .mockResolvedValueOnce([{ id: 'job-1' }])

    const capturedAt = new Date('2026-06-02T09:00:00.000Z')

    await syncTemporalEventsFromThought({
      userId: 'u1',
      thoughtId: 't1',
      normalizedText: 'Report due Friday',
      thoughtEmbedding: [0.5, 0.6],
      capturedAt,
      timezone: 'UTC',
    })

    expect(extractTemporalMentionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capturedAt,
        timezone: 'UTC',
      }),
    )
    expect(db.transaction).toHaveBeenCalledTimes(2)
    expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
    expect(processPendingGraphSyncJobsMock).toHaveBeenCalled()
  })

  it('persists thought capture time in parse_metadata.capturedAt', async () => {
    const capturedAt = new Date('2026-06-02T09:00:00.000Z')
    const insertValuesCalls: unknown[] = []
    const db = makeDb()
    getDbMock.mockReturnValue(db)
    extractTemporalMentionsMock.mockResolvedValue([sampleMention])
    db.insertValues.mockImplementation((values: unknown) => {
      insertValuesCalls.push(values)
      return { returning: db.insertReturning }
    })
    db.insertReturning
      .mockResolvedValueOnce([{ id: 'ev-new' }])
      .mockResolvedValueOnce([{ id: 'job-1' }])

    await syncTemporalEventsFromThought({
      userId: 'u1',
      thoughtId: 't1',
      normalizedText: 'Report due Friday',
      capturedAt,
      timezone: 'UTC',
    })

    const temporalInsert = insertValuesCalls.find(
      (v) => v && typeof v === 'object' && 'parseMetadata' in (v as Record<string, unknown>),
    ) as { parseMetadata?: { capturedAt?: string } } | undefined
    expect(temporalInsert?.parseMetadata?.capturedAt).toBe(capturedAt.toISOString())
  })

  describe('enforced temporal_kind decisions', () => {
    it('asks one per-item temporal_kind decision and persists the DECISION kinds', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['temporal_kind']))
      extractTemporalMentionsMock.mockResolvedValue([
        { ...sampleMention, surface: 'due Friday', kind: 'deadline', confidence: 0.9 },
        { ...sampleMention, surface: 'standup Monday', kind: 'appointment', confidence: 0.8 },
      ])
      runEnforcedPerItemDecisionsMock.mockResolvedValue(
        new Map([
          ['t1', { choice: 'appointment', probability: 0.7, alternatives: { deadline: 0.3 } }],
          ['t2', { choice: 'milestone', probability: 0.6, alternatives: { appointment: 0.4 } }],
        ]),
      )
      const db = makeDb()
      getDbMock.mockReturnValue(db)
      db.insertReturning
        .mockResolvedValueOnce([{ id: 'ev-1' }])
        .mockResolvedValueOnce([{ id: 'job-1' }])
        .mockResolvedValueOnce([{ id: 'ev-2' }])
        .mockResolvedValueOnce([{ id: 'job-2' }])

      await syncTemporalEventsFromThought({
        userId: 'u1',
        thoughtId: 't1',
        normalizedText: 'Report due Friday, standup Monday',
        thoughtEmbedding: [0.5, 0.6],
        capturedAt: new Date('2026-06-02T09:00:00.000Z'),
        timezone: 'UTC',
      })

      expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
      expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          surface: 'enrich_queued',
          kind: 'temporal_kind',
          state: 'Report due Friday, standup Monday',
        }),
      )
      const call = runEnforcedPerItemDecisionsMock.mock.calls[0][0] as {
        criteria: Record<string, string>
        items: Array<Record<string, unknown>>
      }
      expect(Object.keys(call.criteria).sort()).toEqual([
        'appointment',
        'deadline',
        'inferred_event',
        'milestone',
        'period',
        'reminder',
      ])
      expect(call.items).toEqual([
        expect.objectContaining({
          ref: 't1',
          instructions: expect.stringContaining('due Friday'),
          llmChoice: 'deadline',
          llmConfidence: 0.9,
        }),
        expect.objectContaining({
          ref: 't2',
          instructions: expect.stringContaining('standup Monday'),
          llmChoice: 'appointment',
          llmConfidence: 0.8,
        }),
      ])

      // Persisted rows carry the DECISION kinds, in mention order.
      expect(temporalInsertValues(db).map((values) => values.kind)).toEqual([
        'appointment',
        'milestone',
      ])
    })

    it('rejects when the enforced temporal_kind decision fails (no fallback, no ledger mutation)', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['temporal_kind']))
      extractTemporalMentionsMock.mockResolvedValue([sampleMention])
      runEnforcedPerItemDecisionsMock.mockRejectedValue(
        new Error('enforced temporal_kind per-item decision failed: model down'),
      )
      const db = makeDb()
      getDbMock.mockReturnValue(db)

      await expect(
        syncTemporalEventsFromThought({
          userId: 'u1',
          thoughtId: 't1',
          normalizedText: 'Report due Friday',
          thoughtEmbedding: [0.5, 0.6],
        }),
      ).rejects.toThrow(/model down/)

      // The enforced decision runs before any prior-row replacement starts.
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('keeps extraction kinds and skips the decision call when temporal_kind is not enforced', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set())
      extractTemporalMentionsMock.mockResolvedValue([{ ...sampleMention, kind: 'deadline' }])
      const db = makeDb()
      getDbMock.mockReturnValue(db)
      db.insertReturning
        .mockResolvedValueOnce([{ id: 'ev-1' }])
        .mockResolvedValueOnce([{ id: 'job-1' }])

      await syncTemporalEventsFromThought({
        userId: 'u1',
        thoughtId: 't1',
        normalizedText: 'Report due Friday',
        thoughtEmbedding: [0.5, 0.6],
      })

      expect(runEnforcedPerItemDecisionsMock).not.toHaveBeenCalled()
      expect(temporalInsertValues(db).map((values) => values.kind)).toEqual(['deadline'])
    })

    it('skips the decision call when extraction finds no mentions even when enforced', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['temporal_kind']))
      extractTemporalMentionsMock.mockResolvedValue([])
      const db = makeDb()
      getDbMock.mockReturnValue(db)

      await syncTemporalEventsFromThought({
        userId: 'u1',
        thoughtId: 't1',
        normalizedText: 'plain note',
      })

      expect(runEnforcedPerItemDecisionsMock).not.toHaveBeenCalled()
      expect(db.transaction).not.toHaveBeenCalled()
    })
  })
})
