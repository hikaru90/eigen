import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  createThoughtEmbeddingMock,
  applyCaptureContentSplitIfNeededMock,
  extractEnrichThoughtBundleMock,
  extractThoughtMetadataMock,
  enrichThoughtMock,
  loadEnrichmentContextMock,
  decryptTenantValueMock,
  encryptTenantValueMock,
  runIngestWithRetriesMock,
  extractEntityGraphBundleMock,
  shouldRetryEntityMentionExtractionMock,
  loadEntityGraphEnrichmentContextMock,
  getUserPreferredTimezoneMock,
  markEnrichQueueCompleteMock,
  markEnrichQueueFailedMock,
  drainCaptureEnrichQueueMock,
  notifyThoughtEnrichedMock,
  loadProjectContextForThoughtMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  applyCaptureContentSplitIfNeededMock: vi.fn(),
  extractEnrichThoughtBundleMock: vi.fn(),
  extractThoughtMetadataMock: vi.fn(),
  enrichThoughtMock: vi.fn(),
  loadEnrichmentContextMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
  encryptTenantValueMock: vi.fn(),
  runIngestWithRetriesMock: vi.fn(),
  extractEntityGraphBundleMock: vi.fn(),
  shouldRetryEntityMentionExtractionMock: vi.fn(),
  loadEntityGraphEnrichmentContextMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(),
  markEnrichQueueCompleteMock: vi.fn(),
  markEnrichQueueFailedMock: vi.fn(),
  drainCaptureEnrichQueueMock: vi.fn(),
  notifyThoughtEnrichedMock: vi.fn(),
  loadProjectContextForThoughtMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbedding: createThoughtEmbeddingMock }))
vi.mock('$lib/server/capture/apply-capture-content-split', () => ({
  applyCaptureContentSplitIfNeeded: applyCaptureContentSplitIfNeededMock,
}))
vi.mock('$lib/server/capture/enrich-thought-bundle', () => ({
  extractEnrichThoughtBundle: extractEnrichThoughtBundleMock,
}))
vi.mock('$lib/server/memory/extract-thought-metadata', () => ({
  extractThoughtMetadata: extractThoughtMetadataMock,
}))
vi.mock('$lib/server/capture/enrich', () => ({ enrichThought: enrichThoughtMock }))
vi.mock('$lib/server/capture/enrichment-context', () => ({
  loadEnrichmentContext: loadEnrichmentContextMock,
}))
vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  decryptTenantValue: decryptTenantValueMock,
  encryptTenantValue: encryptTenantValueMock,
}))
vi.mock('$lib/server/capture/service', () => ({
  toPgVectorLiteral: (values: number[]) => `[${values.join(',')}]`,
}))
// The retry wrapper has its own dedicated spec (retry.spec.ts); pass through here so
// this spec exercises enrich-queued-thought's own branches deterministically.
vi.mock('$lib/server/ingest/retry', () => ({
  runIngestWithRetries: runIngestWithRetriesMock,
}))
vi.mock('$lib/server/memory/entity-extraction', () => ({
  extractEntityGraphBundle: extractEntityGraphBundleMock,
  shouldRetryEntityMentionExtraction: shouldRetryEntityMentionExtractionMock,
}))
vi.mock('$lib/server/memory/entity-graph-enrichment-context', () => ({
  loadEntityGraphEnrichmentContext: loadEntityGraphEnrichmentContextMock,
}))
vi.mock('$lib/server/memory/user-timezone', () => ({
  getUserPreferredTimezone: getUserPreferredTimezoneMock,
}))
vi.mock('$lib/server/capture/queue-capture', () => ({
  markEnrichQueueComplete: markEnrichQueueCompleteMock,
  markEnrichQueueFailed: markEnrichQueueFailedMock,
}))
vi.mock('$lib/server/capture/enrich-queue-drain', () => ({
  drainCaptureEnrichQueue: drainCaptureEnrichQueueMock,
}))
vi.mock('$lib/server/agents/notify', () => ({
  notifyThoughtEnriched: notifyThoughtEnrichedMock,
}))
vi.mock('$lib/server/agents/project-context', () => ({
  loadProjectContextForThought: loadProjectContextForThoughtMock,
}))

import { enrichQueuedThought, processCaptureEnrichQueue } from './enrich-queued-thought'

/** Chainable select-step: supports `.limit()` and bare `await` (drizzle-style thenable). */
function makeSelectStep(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => rows),
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(rows).then(onFulfilled, onRejected)
        },
      })),
    })),
  }
}

function makeDb(selectQueue: unknown[][]) {
  let i = 0
  const select = vi.fn(() => {
    const rows = selectQueue[i] ?? []
    i += 1
    return makeSelectStep(rows)
  })
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))
  return { select, update, updateSet, updateWhere }
}

const baseRow = {
  id: 't1',
  rawText: 'raw input',
  normalizedText: 'raw input',
  rawTextEncrypted: null,
  normalizedTextEncrypted: null,
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
}

const baseContext = {
  userId: 'u1',
  thoughtId: 't1',
  normalizedText: 'raw input',
  rawText: 'raw input',
  ontology: { entityKinds: [] },
  profile: {},
  groundingProfile: null,
  knownEntities: [],
  recentThoughts: [],
  categoryDistribution: new Map(),
  communityExcerpts: [],
  completeness: {
    knownEntityCount: 0,
    recentThoughtCount: 0,
    communitySummaryCount: 0,
    hasProfileNotes: false,
    hasGroundingProfile: false,
  },
}

const baseBundle = {
  category: { key: 'task', ontologyEntityKindId: 'ek-1', confidence: 0.9, alternatives: [] },
  temporalMentions: [],
  entityGraph: { mentions: [], triples: [] },
}


describe('enrichQueuedThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runIngestWithRetriesMock.mockImplementation(async (op: () => Promise<unknown>) => op())
    applyCaptureContentSplitIfNeededMock.mockImplementation(
      async ({ rawText }: { rawText: string }) => ({ rawText, normalizedText: rawText }),
    )
    loadEnrichmentContextMock.mockResolvedValue(baseContext)
    createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
    extractEnrichThoughtBundleMock.mockResolvedValue(baseBundle)
    extractThoughtMetadataMock.mockResolvedValue(baseMetadata)
    shouldRetryEntityMentionExtractionMock.mockReturnValue(false)
    getUserPreferredTimezoneMock.mockResolvedValue('UTC')
    encryptTenantValueMock.mockImplementation(
      async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`,
    )
    decryptTenantValueMock.mockImplementation(async ({ ciphertext }: { ciphertext: string }) =>
      ciphertext.startsWith('enc:') ? ciphertext.slice(4) : ciphertext,
    )
    enrichThoughtMock.mockResolvedValue(undefined)
    markEnrichQueueCompleteMock.mockResolvedValue(undefined)
    markEnrichQueueFailedMock.mockResolvedValue(undefined)
    loadProjectContextForThoughtMock.mockResolvedValue({ projectEntityIds: [], projectLabels: [] })
  })

  it('runs the full pipeline, persists classify/embed, and notifies on success', async () => {
    const db = makeDb([
      [baseRow], // row lookup
      [{ metadata: {}, metadataEncrypted: null }], // encryptMetadataPatch existing row
      [{ n: 5 }], // countRow
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }], // enrichedRow check
      [
        {
          normalizedText: 'raw input',
          category: 'task',
          enrichedAt: new Date('2026-06-01T00:05:00.000Z'),
        },
      ], // enrichedThought for notify
    ])
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'task', ontologyEntityKindId: 'ek-1' }),
    )
    expect(enrichThoughtMock).toHaveBeenCalledWith(
      'u1',
      't1',
      'raw input',
      expect.objectContaining({
        thoughtEmbedding: [0.1, 0.2],
        deferRelations: true,
        precomputedMetadata: baseMetadata,
      }),
    )
    expect(extractThoughtMetadataMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', normalizedText: 'raw input' }),
    )
    expect(markEnrichQueueCompleteMock).toHaveBeenCalledWith('t1')
    expect(notifyThoughtEnrichedMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', thoughtId: 't1', category: 'task' }),
    )
  })

  it('decrypts encrypted raw/normalized text before enriching', async () => {
    const db = makeDb([
      [
        {
          ...baseRow,
          rawText: '',
          normalizedText: '',
          rawTextEncrypted: 'enc:secret raw',
          normalizedTextEncrypted: 'enc:secret normalized',
        },
      ],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
      [
        {
          normalizedText: 'secret normalized',
          category: 'task',
          enrichedAt: null,
        },
      ],
    ])
    getDbMock.mockReturnValue(db)
    applyCaptureContentSplitIfNeededMock.mockImplementation(
      async ({ rawText }: { rawText: string }) => ({
        rawText,
        normalizedText: 'secret normalized',
      }),
    )

    await enrichQueuedThought('u1', 't1')

    expect(decryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ ciphertext: 'enc:secret raw' }),
    )
    expect(decryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ ciphertext: 'enc:secret normalized' }),
    )
    expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rawText: 'secret raw',
        existingNormalizedText: 'secret normalized',
      }),
    )
  })

  it('uses pre-loaded context and skips loadEnrichmentContext when options.context is provided', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1', { context: baseContext })

    expect(loadEnrichmentContextMock).not.toHaveBeenCalled()
  })

  it('falls back to entity-only extraction when the bundle returns zero mentions and a retry is warranted', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)
    loadEnrichmentContextMock.mockResolvedValue({
      ...baseContext,
      ontology: { entityKinds: [{ key: 'person', active: true, kindType: 'entity_type' }] },
    })
    shouldRetryEntityMentionExtractionMock.mockReturnValue(true)
    loadEntityGraphEnrichmentContextMock.mockResolvedValue({
      communityExcerpts: [],
      graphEntities: [],
    })
    extractEntityGraphBundleMock.mockResolvedValue({
      mentions: [{ surface: 'Jonas', entityType: 'person', confidence: 0.8 }],
      triples: [],
    })

    await enrichQueuedThought('u1', 't1')

    expect(extractEntityGraphBundleMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', normalizedText: 'raw input' }),
    )
    expect(enrichThoughtMock).toHaveBeenCalledWith(
      'u1',
      't1',
      'raw input',
      expect.objectContaining({
        precomputedEntityGraph: {
          mentions: [{ surface: 'Jonas', entityType: 'person', confidence: 0.8 }],
          triples: [],
        },
      }),
    )
  })

  it('marks the queue row failed and rethrows when the thought row is missing', async () => {
    const db = makeDb([[]])
    getDbMock.mockReturnValue(db)

    await expect(enrichQueuedThought('u1', 'missing')).rejects.toThrow(
      'Queued thought not found: missing',
    )
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith(
      'missing',
      'Queued thought not found: missing',
    )
    expect(markEnrichQueueCompleteMock).not.toHaveBeenCalled()
  })

  it('fails when enrichThought completes without setting enriched_at', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [], // enrichedRow lookup returns nothing -> enrichedAt missing
    ])
    getDbMock.mockReturnValue(db)

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(
      'Enrichment finished without setting enriched_at',
    )
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith(
      't1',
      'Enrichment finished without setting enriched_at',
    )
  })

  it('skips notify when the post-completion enriched row has no enriched_at', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(markEnrichQueueCompleteMock).toHaveBeenCalledWith('t1')
    expect(notifyThoughtEnrichedMock).not.toHaveBeenCalled()
  })

  it('reports progress events through onProgress', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)

    const phases: string[] = []
    await enrichQueuedThought('u1', 't1', {
      onProgress: async (e) => {
        if (!e.parallel) phases.push(e.phase)
      },
    })

    expect(phases).toEqual(['content_split', 'ontology', 'embedding'])
  })

  it('logs and rethrows when the pipeline throws for a reason unrelated to missing rows', async () => {
    const db = makeDb([[baseRow]])
    getDbMock.mockReturnValue(db)
    applyCaptureContentSplitIfNeededMock.mockRejectedValue(new Error('split failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow('split failed')
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', 'split failed')
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('stringifies non-Error throws for the failure message', async () => {
    const db = makeDb([[baseRow]])
    getDbMock.mockReturnValue(db)
    applyCaptureContentSplitIfNeededMock.mockRejectedValue('plain string failure')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enrichQueuedThought('u1', 't1')).rejects.toBe('plain string failure')
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', 'plain string failure')
    errorSpy.mockRestore()
  })

  it('decrypts existing metadataEncrypted before merging the classify/embed patch', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: null, metadataEncrypted: 'enc:{"foo":"bar"}' }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(decryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({ ciphertext: 'enc:{"foo":"bar"}' }),
    )
    expect(encryptTenantValueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        plaintext: expect.stringContaining('"foo":"bar"'),
      }),
    )
  })

  it('emits graph-scale quiet console logs when GRAPH_SCALE_QUIET=1', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)
    loadEnrichmentContextMock.mockResolvedValue({
      ...baseContext,
      ontology: { entityKinds: [{ key: 'person', active: true, kindType: 'entity_type' }] },
    })
    loadEntityGraphEnrichmentContextMock.mockResolvedValue({
      communityExcerpts: [],
      graphEntities: [],
    })
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const prevQuiet = process.env.GRAPH_SCALE_QUIET
    process.env.GRAPH_SCALE_QUIET = '1'

    try {
      await enrichQueuedThought('u1', 't1')
      expect(infoSpy.mock.calls.some((c) => c[0] === '[graph-scale] enrich pipeline start')).toBe(
        true,
      )
    } finally {
      if (prevQuiet === undefined) delete process.env.GRAPH_SCALE_QUIET
      else process.env.GRAPH_SCALE_QUIET = prevQuiet
      infoSpy.mockRestore()
    }
  })

  it('logs graph-scale error tag on failure when GRAPH_SCALE_QUIET=1', async () => {
    const db = makeDb([[baseRow]])
    getDbMock.mockReturnValue(db)
    applyCaptureContentSplitIfNeededMock.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const prevQuiet = process.env.GRAPH_SCALE_QUIET
    process.env.GRAPH_SCALE_QUIET = '1'

    try {
      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow('boom')
    } finally {
      if (prevQuiet === undefined) delete process.env.GRAPH_SCALE_QUIET
      else process.env.GRAPH_SCALE_QUIET = prevQuiet
      infoSpy.mockRestore()
    }

    expect(errorSpy).toHaveBeenCalledWith(
      '[graph-scale] enrich failed',
      expect.objectContaining({ userId: 'u1', thoughtId: 't1', message: 'boom' }),
    )
    errorSpy.mockRestore()
  })
})

describe('processCaptureEnrichQueue', () => {
  it('delegates to drainCaptureEnrichQueue', async () => {
    drainCaptureEnrichQueueMock.mockResolvedValue(3)

    const count = await processCaptureEnrichQueue('u1', { maxItems: 10 } as never)

    expect(count).toBe(3)
    expect(drainCaptureEnrichQueueMock).toHaveBeenCalledWith('u1', { maxItems: 10 })
  })
})
