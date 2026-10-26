import { beforeEach, describe, expect, it, vi } from 'vitest'
import { envPaste, FAKE_SECRETS, guardWouldTrip, leaks } from '$lib/test/secret-fixtures'

const {
  getDbMock,
  createThoughtEmbeddingMock,
  applyCaptureContentSplitIfNeededMock,
  extractEnrichThoughtBundleMock,
  enrichThoughtMock,
  loadEnrichmentContextMock,
  decryptTenantValueMock,
  encryptTenantValueMock,
  runIngestWithRetriesMock,
  loadEntityGraphEnrichmentContextMock,
  getUserPreferredTimezoneMock,
  markEnrichQueueCompleteMock,
  markEnrichQueueFailedMock,
  drainCaptureEnrichQueueMock,
  notifyThoughtEnrichedMock,
  loadProjectContextForThoughtMock,
  resolveShadowConfigMock,
  resolveEnforceKindsMock,
  runDecisionModelMock,
  logActivityCallMock,
  applyForgetRequestMock,
  deriveUserFactsMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  applyCaptureContentSplitIfNeededMock: vi.fn(),
  extractEnrichThoughtBundleMock: vi.fn(),
  enrichThoughtMock: vi.fn(),
  loadEnrichmentContextMock: vi.fn(),
  decryptTenantValueMock: vi.fn(),
  encryptTenantValueMock: vi.fn(),
  runIngestWithRetriesMock: vi.fn(),
  loadEntityGraphEnrichmentContextMock: vi.fn(),
  getUserPreferredTimezoneMock: vi.fn(),
  markEnrichQueueCompleteMock: vi.fn(),
  markEnrichQueueFailedMock: vi.fn(),
  drainCaptureEnrichQueueMock: vi.fn(),
  notifyThoughtEnrichedMock: vi.fn(),
  loadProjectContextForThoughtMock: vi.fn(),
  resolveShadowConfigMock: vi.fn(),
  resolveEnforceKindsMock: vi.fn(),
  runDecisionModelMock: vi.fn(),
  logActivityCallMock: vi.fn(),
  applyForgetRequestMock: vi.fn(),
  deriveUserFactsMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/embedding', () => ({ createThoughtEmbedding: createThoughtEmbeddingMock }))
vi.mock('$lib/server/capture/apply-capture-content-split', () => ({
  applyCaptureContentSplitIfNeeded: applyCaptureContentSplitIfNeededMock,
}))
vi.mock('$lib/server/capture/enrich-thought-bundle', () => ({
  extractEnrichThoughtBundle: extractEnrichThoughtBundleMock,
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
vi.mock('$lib/server/capture/apply-forget-request', () => ({
  applyForgetRequest: applyForgetRequestMock,
}))
vi.mock('$lib/server/activity/log-call', () => ({
  logActivityCall: logActivityCallMock,
}))
vi.mock('$lib/server/facts/derive-user-facts', () => ({
  deriveUserFactsForThought: deriveUserFactsMock,
}))
// decision-plane stays REAL — only its OpenRouter client is mocked, so these
// tests exercise the actual enforcement/settle contract.
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return {
    ...actual,
    resolveDecisionShadowConfig: resolveShadowConfigMock,
    resolveDecisionEnforceKinds: resolveEnforceKindsMock,
    runDecisionModel: runDecisionModelMock,
  }
})

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
  const insertValues = vi.fn(async () => undefined)
  const insert = vi.fn(() => ({ values: insertValues }))
  return { select, update, updateSet, updateWhere, insert, insertValues }
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
  ontology: {
    entityKinds: [],
    entityKindsByKey: new Map(
      [
        { id: 'ek-1', key: 'task', active: true, kindType: 'thought_category' },
        { id: 'ek-idea', key: 'idea', active: true, kindType: 'thought_category' },
      ].map((k) => [k.key, k]),
    ),
  },
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
  cues: ['cue one', 'cue two'],
  askQuestion: 'What did I capture about the raw input?',
  temporalMentions: [],
  entityGraph: { mentions: [], triples: [] },
}

describe('enrichQueuedThought', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runIngestWithRetriesMock.mockImplementation(async (op: () => Promise<unknown>) => op())
    applyCaptureContentSplitIfNeededMock.mockImplementation(
      async ({ rawText }: { rawText: string }) => ({
        rawText,
        enrichRawText: rawText,
        normalizedText: rawText,
        role: 'personal' as const,
        attachedFileId: null,
        childThoughtIds: [],
      }),
    )
    loadEnrichmentContextMock.mockResolvedValue(baseContext)
    createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2])
    extractEnrichThoughtBundleMock.mockResolvedValue(baseBundle)
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
    // Decision plane defaults: nothing enforced, shadow disabled (env unset).
    resolveEnforceKindsMock.mockReturnValue(new Set())
    resolveShadowConfigMock.mockReturnValue(null)
    logActivityCallMock.mockResolvedValue(undefined)
    deriveUserFactsMock.mockResolvedValue({ added: 0, superseded: 0, confirmed: 0, droppedLowConfidence: 0 })
  })

  function decisionResponse(answers: Record<string, { choice: string; probabilities: Record<string, number> }>) {
    return {
      model: 'typesafe/jev-1.13',
      answers: Object.fromEntries(
        Object.entries({
          // shadow capture_intent rides along with the generic call: the pipeline stores (default)
          capture_intent: { choice: 'store', probabilities: { store: 0.95, forget: 0.05 } },
          ...answers,
        }).map(([id, a]) => [
          id,
          { type: 'choice', choice: a.choice, probabilities: a.probabilities, confidence: 0.5 },
        ]),
      ),
      usage: { input_tokens: 5, output_tokens: 1 },
      reportedCostUsd: 0.0000421,
    }
  }

  function standardDbQueue() {
    return makeDb([
      [baseRow], // row lookup
      [{ metadata: {}, metadataEncrypted: null }], // encryptMetadataPatch existing row
      [{ n: 5 }], // countRow
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }], // enrichedRow check
      [
        {
          normalizedText: 'raw input',
          category: 'idea',
          enrichedAt: new Date('2026-06-01T00:05:00.000Z'),
        },
      ], // enrichedThought for notify
    ])
  }

  function metadataPatchCalls(): Record<string, unknown>[] {
    return encryptTenantValueMock.mock.calls
      .map((c) => c[0] as { column?: string; plaintext?: string })
      .filter((a) => typeof a.plaintext === 'string' && a.plaintext.includes('categorySource'))
      .map((a) => JSON.parse(a.plaintext ?? '{}') as Record<string, unknown>)
  }

  it('enforced category: the decision-model answer overrides the bundle at persist', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['category']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockResolvedValue(
      decisionResponse({
        category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.3, observation: 0.1 } },
        content_role: { choice: 'personal', probabilities: { personal: 0.8, reference: 0.15, mixed: 0.05 } },
      }),
    )
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'idea', ontologyEntityKindId: 'ek-idea' }),
    )
    const patch = metadataPatchCalls()[0]
    expect(patch).toMatchObject({
      categorySource: 'decision_model',
      categoryConfidence: 0.6,
      categoryAlternatives: [
        { key: 'task', confidence: 0.3 },
        { key: 'observation', confidence: 0.1 },
      ],
    })
    // The bundle's category is still recorded as the comparison primary.
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataEncrypted: expect.stringContaining('decision_model'),
      }),
    )
  })

  it('enforced category: an off-catalog decision-model key fails the enrich loudly', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['category']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockResolvedValue(
      decisionResponse({
        category: { choice: 'made_up_key', probabilities: { made_up_key: 1 } },
        content_role: { choice: 'personal', probabilities: { personal: 1 } },
      }),
    )
    getDbMock.mockReturnValue(standardDbQueue())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/made_up_key/)
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', expect.stringContaining('made_up_key'))
    // No partial persist: classify/embed never ran.
    expect(enrichThoughtMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  describe('secret hygiene (docs/planning/secret-hygiene.md)', () => {
    /** Everything the pipeline hands to an LLM client, an embedding or a persisted index. */
    function everythingDownstream(): string {
      return JSON.stringify([
        runDecisionModelMock.mock.calls,
        applyCaptureContentSplitIfNeededMock.mock.calls,
        loadEnrichmentContextMock.mock.calls,
        createThoughtEmbeddingMock.mock.calls,
        extractEnrichThoughtBundleMock.mock.calls.map(([arg]) => ({
          capturedAt: (arg as { capturedAt: Date }).capturedAt,
        })),
        enrichThoughtMock.mock.calls.map((call) => call.slice(0, 3)),
        encryptTenantValueMock.mock.calls,
      ])
    }

    function secretDb(row: Record<string, unknown>) {
      return makeDb([
        [row],
        [{ metadata: {}, metadataEncrypted: null }],
        [{ n: 5 }],
        [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
        [{ normalizedText: 'x', category: 'idea', enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
      ])
    }

    it('feeds the content_role decision, the split, the context, the embedding and enrich only redacted text', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['content_role']))
      resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
      runDecisionModelMock
        .mockResolvedValueOnce(
          decisionResponse({
            content_role: { choice: 'personal', probabilities: { personal: 0.9, reference: 0.1 } },
          }),
        )
        .mockResolvedValueOnce(decisionResponse({ category: { choice: 'task', probabilities: { task: 0.7 } } }))
      const raw = envPaste()
      // normalized_text as queueCapture stores it (redacted); raw_text verbatim
      getDbMock.mockReturnValue(
        secretDb({
          ...baseRow,
          rawText: raw,
          normalizedText:
            'DATABASE_URL=postgres://user:[redacted secret]@localhost:5432/mydb LLM_API_KEY=[redacted secret] PORT=3000',
        }),
      )

      await enrichQueuedThought('u1', 't1')

      expect(leaks(everythingDownstream())).toBe(false)
      expect(runDecisionModelMock).toHaveBeenCalled()
      expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText:
            'DATABASE_URL=postgres://user:[redacted secret]@localhost:5432/mydb LLM_API_KEY=[redacted secret] PORT=3000',
        }),
      )
      expect(loadEnrichmentContextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          rawText: expect.stringContaining('[redacted secret]'),
          normalizedText: expect.stringContaining('[redacted secret]'),
        }),
      )
    })

    it('also cleans a legacy row whose stored normalized_text still holds a secret', async () => {
      const raw = `token ${FAKE_SECRETS.githubClassic} for deploy`
      getDbMock.mockReturnValue(secretDb({ ...baseRow, rawText: raw, normalizedText: raw }))

      await enrichQueuedThought('u1', 't1')

      expect(leaks(everythingDownstream())).toBe(false)
      expect(enrichThoughtMock).toHaveBeenCalledWith(
        'u1',
        't1',
        'token [redacted secret] for deploy',
        expect.anything(),
      )
    })

    it('does not trip the gateway guard on the capture path (the boundary already redacted)', async () => {
      const raw = envPaste()
      getDbMock.mockReturnValue(secretDb({ ...baseRow, rawText: raw, normalizedText: raw }))

      await enrichQueuedThought('u1', 't1')

      const payloads = [
        runDecisionModelMock.mock.calls,
        applyCaptureContentSplitIfNeededMock.mock.calls,
        loadEnrichmentContextMock.mock.calls,
        createThoughtEmbeddingMock.mock.calls,
        enrichThoughtMock.mock.calls.map((call) => call.slice(0, 3)),
      ]
      expect(guardWouldTrip(payloads)).toBe(false)
    })
  })

  it('enforced content_role: the early call decides the role and the generation call receives it', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['content_role']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock
      .mockResolvedValueOnce(
        decisionResponse({
          content_role: { choice: 'reference', probabilities: { reference: 0.9, personal: 0.1 } },
        }),
      )
      .mockResolvedValueOnce(
        decisionResponse({
          category: { choice: 'task', probabilities: { task: 0.7 } },
        }),
      )
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    // Two Decisions calls: early content_role, then main shadow (category + the shadow-only
    // capture_intent — content_role is excluded because the early call already decided it).
    expect(runDecisionModelMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions)).toEqual(['content_role'])
    expect(Object.keys(runDecisionModelMock.mock.calls[1][1].questions)).toEqual(['category', 'capture_intent'])

    expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
      expect.objectContaining({ decidedRole: 'reference' }),
    )
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'task', ontologyEntityKindId: 'ek-1' }),
    )
    expect(metadataPatchCalls()[0]).toMatchObject({ categorySource: 'llm' })
  })

  it('enforced category+content_role: both kinds drive persist from one early + one shadow call', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['category', 'content_role']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock
      .mockResolvedValueOnce(
        decisionResponse({
          content_role: { choice: 'personal', probabilities: { personal: 0.8, reference: 0.15, mixed: 0.05 } },
        }),
      )
      .mockResolvedValueOnce(
        decisionResponse({
          category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
        }),
      )
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
      expect.objectContaining({ decidedRole: 'personal' }),
    )
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'idea', ontologyEntityKindId: 'ek-idea' }),
    )
    expect(metadataPatchCalls()[0]).toMatchObject({ categorySource: 'decision_model' })
  })

  it('enforced content_role: a retired thought_only/split choice fails the enrich loudly and nothing is applied', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['content_role']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockResolvedValue(
      decisionResponse({
        content_role: { choice: 'thought_only', probabilities: { thought_only: 0.9, split: 0.1 } },
      }),
    )
    getDbMock.mockReturnValue(standardDbQueue())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/off-catalog choice "thought_only"/)
    expect(applyCaptureContentSplitIfNeededMock).not.toHaveBeenCalled()
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', expect.stringContaining('thought_only'))
    errorSpy.mockRestore()
  })

  it('shadow-only content_role: the role the judge applied is the chat primary beside the decision model', async () => {
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockResolvedValue(
      decisionResponse({
        category: { choice: 'task', probabilities: { task: 0.7 } },
        content_role: { choice: 'mixed', probabilities: { mixed: 0.6, personal: 0.4 } },
      }),
    )
    applyCaptureContentSplitIfNeededMock.mockImplementation(
      async ({ rawText }: { rawText: string }) => ({
        rawText,
        enrichRawText: rawText,
        normalizedText: rawText,
        role: 'mixed' as const,
        attachedFileId: 'file-1',
        childThoughtIds: [],
      }),
    )
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
      expect.objectContaining({ decidedRole: undefined }),
    )
    const rows = db.insertValues.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>)
    expect(rows.find((r) => r.decisionKind === 'content_role')).toMatchObject({
      llmChoice: 'mixed',
      decisionChoice: 'mixed',
      agree: true,
      authoritativeEngine: 'chat_judge',
    })
  })

  it('enrichment sees the thought\'s own text, never the whole capture of a split thought', async () => {
    const recipe = 'Carbonara recipe from Nonna\n\nIngredients: spaghetti, guanciale, eggs…'
    applyCaptureContentSplitIfNeededMock.mockResolvedValue({
      rawText: recipe,
      enrichRawText: 'Carbonara recipe from Nonna',
      normalizedText: 'Carbonara recipe from Nonna',
      role: 'reference' as const,
      attachedFileId: 'file-1',
      childThoughtIds: [],
    })
    getDbMock.mockReturnValue(
      makeDb([
        [{ ...baseRow, rawText: recipe, normalizedText: recipe }],
        [{ metadata: {}, metadataEncrypted: null }],
        [{ n: 5 }],
        [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
        [{ normalizedText: 'Carbonara recipe from Nonna', category: 'idea', enrichedAt: new Date() }],
      ]),
    )

    await enrichQueuedThought('u1', 't1')

    expect(loadEnrichmentContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedText: 'Carbonara recipe from Nonna',
        rawText: 'Carbonara recipe from Nonna',
      }),
    )
  })

  describe('a role is decided exactly once per capture', () => {
    function rowWithMetadata(metadata: Record<string, unknown>) {
      return makeDb([
        [{ ...baseRow, metadata: { encrypted: true }, metadataEncrypted: `enc:${JSON.stringify(metadata)}` }],
        [{ metadata: {}, metadataEncrypted: null }],
        [{ n: 5 }],
        [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
        [{ normalizedText: 'raw input', category: 'idea', enrichedAt: new Date() }],
      ])
    }

    it('a span child (metadata.splitFrom) asks no content_role question at all', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['content_role']))
      resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
      runDecisionModelMock.mockResolvedValue(
        decisionResponse({ category: { choice: 'task', probabilities: { task: 0.7 } } }),
      )
      getDbMock.mockReturnValue(rowWithMetadata({ splitFrom: 'parent-1' }))

      await enrichQueuedThought('u1', 'child-1')

      // only the generic call (category) — no early content_role call, no content_role question
      expect(runDecisionModelMock).toHaveBeenCalledTimes(1)
      expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions)).toEqual(['category'])
      expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
        expect.objectContaining({ decidedRole: undefined }),
      )
    })

    it('a retried attempt that already persisted its plan resumes it without deciding again', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['content_role']))
      resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
      runDecisionModelMock.mockResolvedValue(
        decisionResponse({ category: { choice: 'task', probabilities: { task: 0.7 } } }),
      )
      getDbMock.mockReturnValue(
        rowWithMetadata({
          captureContentSplit: {
            role: 'personal',
            rationale: 'r',
            spans: ['a', 'b'],
            spanThoughtIds: ['t1', 'child-1'],
            note: null,
            attachedFileId: null,
          },
        }),
      )

      await enrichQueuedThought('u1', 't1')

      expect(runDecisionModelMock).toHaveBeenCalledTimes(1)
      expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions)).toEqual(['category'])
      expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledTimes(1)
    })

    it('a marker with a role outside the three fails the enrich loudly', async () => {
      getDbMock.mockReturnValue(
        rowWithMetadata({ captureContentSplit: { role: 'both', rationale: 'r', spans: [], spanThoughtIds: [], note: null, attachedFileId: null } }),
      )
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/role/)
      expect(applyCaptureContentSplitIfNeededMock).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  it('enforced entity_type: per-mention decision answers override the bundle graph before persist', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['entity_type']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockImplementation(async (_config, request) => {
      const ids = Object.keys(request.questions)
      if (ids.some((id) => id.startsWith('entity_type:'))) {
        return decisionResponse({
          'entity_type:m1': {
            choice: 'person',
            probabilities: { person: 0.9, organization: 0.05, concept: 0.05 },
          },
          'entity_type:m2': {
            choice: 'organization',
            probabilities: { organization: 0.8, person: 0.1, concept: 0.1 },
          },
        })
      }
      return decisionResponse({
        category: { choice: 'task', probabilities: { task: 0.7, idea: 0.3 } },
        content_role: { choice: 'personal', probabilities: { personal: 0.8, reference: 0.15, mixed: 0.05 } },
      })
    })
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)
    loadEnrichmentContextMock.mockResolvedValue({
      ...baseContext,
      ontology: {
        ...baseContext.ontology,
        entityKinds: [
          {
            id: 'ek-p',
            key: 'person',
            name: 'Person',
            definition: 'A human being',
            active: true,
            kindType: 'entity_type',
            neverStale: false,
          },
          {
            id: 'ek-o',
            key: 'organization',
            name: 'Organization',
            definition: 'A company or group',
            active: true,
            kindType: 'entity_type',
            neverStale: false,
          },
          {
            id: 'ek-c',
            key: 'concept',
            name: 'Concept',
            definition: 'An abstract idea',
            active: true,
            kindType: 'entity_type',
            neverStale: false,
          },
        ],
      },
    })
    loadEntityGraphEnrichmentContextMock.mockResolvedValue({ communityExcerpts: [], graphEntities: [] })
    extractEnrichThoughtBundleMock.mockResolvedValue({
      ...baseBundle,
      entityGraph: {
        mentions: [
          { surface: 'Jonas', entityType: 'person', confidence: 0.8 },
          { surface: 'EigenMesh', entityType: 'concept', confidence: 0.7 },
        ],
        triples: [],
      },
    })

    await enrichQueuedThought('u1', 't1')

    // The persisted entity graph carries the decision-model answers, not the bundle's.
    expect(enrichThoughtMock).toHaveBeenCalledWith(
      'u1',
      't1',
      'raw input',
      expect.objectContaining({
        precomputedEntityGraph: {
          mentions: [
            { surface: 'Jonas', entityType: 'person', confidence: 0.9 },
            { surface: 'EigenMesh', entityType: 'organization', confidence: 0.8 },
          ],
          triples: [],
        },
      }),
    )

    // Two Decisions calls: the generic shadow (entity_type excluded when
    // enforced) and one per-mention call keyed entity_type:<ref>.
    expect(runDecisionModelMock).toHaveBeenCalledTimes(2)
    const perItemCall = runDecisionModelMock.mock.calls.find((c) =>
      Object.keys(c[1].questions).some((id) => id.startsWith('entity_type:')),
    )
    expect(Object.keys(perItemCall?.[1].questions ?? {})).toEqual(['entity_type:m1', 'entity_type:m2'])
    expect(perItemCall?.[1].questions['entity_type:m1'].criteria).toEqual({
      person: 'Person: A human being',
      organization: 'Organization: A company or group',
      concept: 'Concept: An abstract idea',
    })

    // One decision_shadow_log row per mention, with the bundle's typing as
    // the comparison primary and the decision model as the authority.
    const rows = db.insertValues.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>)
    const entityRows = rows.filter((r) => r.decisionKind === 'entity_type')
    expect(entityRows).toHaveLength(2)
    expect(entityRows.map((r) => r.subjectRef)).toEqual(['m1', 'm2'])
    for (const row of entityRows) {
      expect(row.authoritativeEngine).toBe('decision_model')
    }
    expect(entityRows[0]).toMatchObject({ llmChoice: 'person', decisionChoice: 'person', agree: true })
    expect(entityRows[1]).toMatchObject({
      llmChoice: 'concept',
      decisionChoice: 'organization',
      agree: false,
    })
  })

  it('enforced entity_type: a failed decision call fails the enrich loudly (no fallback)', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['entity_type']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockRejectedValue(new Error('decision engine down'))
    getDbMock.mockReturnValue(standardDbQueue())
    loadEnrichmentContextMock.mockResolvedValue({
      ...baseContext,
      ontology: {
        ...baseContext.ontology,
        entityKinds: [
          {
            id: 'ek-p',
            key: 'person',
            name: 'Person',
            definition: 'A human being',
            active: true,
            kindType: 'entity_type',
            neverStale: false,
          },
        ],
      },
    })
    extractEnrichThoughtBundleMock.mockResolvedValue({
      ...baseBundle,
      entityGraph: {
        mentions: [{ surface: 'Jonas', entityType: 'person', confidence: 0.8 }],
        triples: [],
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(
      /enforced entity_type per-item decision failed.*decision engine down/,
    )
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('decision engine down'),
    )
    // No fallback path: the pipeline never reached persist/enrich.
    expect(enrichThoughtMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('enforced open_loop+salience_band: ONE bounded call decides both and the metadata patch persists them', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['open_loop', 'salience_band']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockImplementation(async (_config, request) => {
      const ids = Object.keys(request.questions)
      if (ids.includes('open_loop')) {
        return decisionResponse({
          open_loop: {
            choice: 'actionable',
            probabilities: { actionable: 0.8, mentioned: 0.15, closed: 0.05 },
          },
          salience_band: {
            choice: 'high',
            probabilities: { high: 0.7, medium: 0.2, low: 0.1 },
          },
        })
      }
      return decisionResponse({
        category: { choice: 'task', probabilities: { task: 0.7, idea: 0.3 } },
        content_role: { choice: 'personal', probabilities: { personal: 0.8, reference: 0.15, mixed: 0.05 } },
      })
    })
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    // Exactly ONE bounded Decisions call carrying BOTH whole-question specs
    // (the other runDecisionModel call is the generic category/content_role shadow).
    const boundedCalls = runDecisionModelMock.mock.calls.filter((c) =>
      Object.keys(c[1].questions).includes('open_loop'),
    )
    expect(boundedCalls).toHaveLength(1)
    expect(Object.keys(boundedCalls[0][1].questions)).toEqual(['open_loop', 'salience_band'])
    expect(boundedCalls[0][1].questions.open_loop.instructions).toBe(
      'Is this capture a live commitment, a mere mention of one, or already closed?',
    )
    expect(boundedCalls[0][1].questions.open_loop.criteria).toEqual({
      actionable: 'A live commitment — the user intends to do this.',
      mentioned: 'Merely mentions a task or commitment without itself being one.',
      closed: 'A commitment already completed or closed off.',
    })
    expect(boundedCalls[0][1].questions.salience_band.instructions).toBe(
      'How salient is this capture likely to be for later recall?',
    )
    expect(boundedCalls[0][1].questions.salience_band.criteria).toEqual({
      high: 'Central, frequently-relevant material for this user.',
      medium: 'Ordinary everyday relevance.',
      low: 'Peripheral, ephemeral, or small-talk.',
    })

    // The mocked Jev answers land in the EXISTING metadata patch — metadata
    // only, no schema change.
    expect(metadataPatchCalls()[0]).toMatchObject({
      openLoop: 'actionable',
      saliencePrior: 'high',
    })

    // Evidence rows: one per bounded kind, no comparison primary (llmChoice null).
    const rows = db.insertValues.mock.calls.flatMap((c) => c[0] as Array<Record<string, unknown>>)
    const boundedRows = rows.filter(
      (r) => r.decisionKind === 'open_loop' || r.decisionKind === 'salience_band',
    )
    expect(boundedRows).toHaveLength(2)
    for (const row of boundedRows) {
      expect(row.llmChoice).toBeNull()
      expect(row.authoritativeEngine).toBe('decision_model')
    }
  })

  it('enforced salience_band only: one spec in the call and only saliencePrior in the patch', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['salience_band']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockImplementation(async (_config, request) => {
      const ids = Object.keys(request.questions)
      if (ids.includes('salience_band')) {
        return decisionResponse({
          salience_band: { choice: 'low', probabilities: { low: 0.9, medium: 0.1 } },
        })
      }
      return decisionResponse({
        category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
        content_role: { choice: 'personal', probabilities: { personal: 1 } },
      })
    })
    getDbMock.mockReturnValue(standardDbQueue())

    await enrichQueuedThought('u1', 't1')

    const boundedCalls = runDecisionModelMock.mock.calls.filter((c) =>
      Object.keys(c[1].questions).includes('salience_band'),
    )
    expect(boundedCalls).toHaveLength(1)
    expect(Object.keys(boundedCalls[0][1].questions)).toEqual(['salience_band'])
    const patch = metadataPatchCalls()[0]
    expect(patch).toMatchObject({ saliencePrior: 'low' })
    expect(patch).not.toHaveProperty('openLoop')
  })

  it('salience seeding (O2): band high seeds initial salienceScore 1.5 at persist', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['salience_band']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockImplementation(async (_config, request) => {
      const ids = Object.keys(request.questions)
      if (ids.includes('salience_band')) {
        return decisionResponse({
          salience_band: { choice: 'high', probabilities: { high: 0.9, medium: 0.1 } },
        })
      }
      return decisionResponse({
        category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
        content_role: { choice: 'personal', probabilities: { personal: 1 } },
      })
    })
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({ salienceScore: 1.5 }))
  })

  it('salience seeding (O2): band low seeds initial salienceScore 0.6 at persist', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['salience_band']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockImplementation(async (_config, request) => {
      const ids = Object.keys(request.questions)
      if (ids.includes('salience_band')) {
        return decisionResponse({
          salience_band: { choice: 'low', probabilities: { low: 0.8, medium: 0.2 } },
        })
      }
      return decisionResponse({
        category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
        content_role: { choice: 'personal', probabilities: { personal: 1 } },
      })
    })
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({ salienceScore: 0.6 }))
  })

  it('salience seeding (O2): band medium does not set salienceScore (column default applies)', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['salience_band']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockImplementation(async (_config, request) => {
      const ids = Object.keys(request.questions)
      if (ids.includes('salience_band')) {
        return decisionResponse({
          salience_band: { choice: 'medium', probabilities: { medium: 0.9, low: 0.1 } },
        })
      }
      return decisionResponse({
        category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
        content_role: { choice: 'personal', probabilities: { personal: 1 } },
      })
    })
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(db.updateSet).toHaveBeenCalledTimes(1)
    const setArg = db.updateSet.mock.calls[0][0] as Record<string, unknown>
    expect(setArg).not.toHaveProperty('salienceScore')
  })

  it('salience seeding (O2): enforcement off leaves the persist update without salienceScore', async () => {
    // beforeEach defaults: nothing enforced, decision-model config absent.
    const db = standardDbQueue()
    getDbMock.mockReturnValue(db)

    await enrichQueuedThought('u1', 't1')

    expect(runDecisionModelMock).not.toHaveBeenCalled()
    expect(db.updateSet).toHaveBeenCalledTimes(1)
    const setArg = db.updateSet.mock.calls[0][0] as Record<string, unknown>
    expect(setArg).not.toHaveProperty('salienceScore')
  })

  it('open_loop/salience_band enforcement off: no bounded call and no metadata keys', async () => {
    // beforeEach defaults: nothing enforced, decision-model config absent.
    getDbMock.mockReturnValue(standardDbQueue())

    await enrichQueuedThought('u1', 't1')

    expect(runDecisionModelMock).not.toHaveBeenCalled()
    expect(metadataPatchCalls()[0]).not.toHaveProperty('openLoop')
    expect(metadataPatchCalls()[0]).not.toHaveProperty('saliencePrior')
  })

  it('enforced open_loop+salience_band: a failed bounded call fails the enrich loudly (no fallback)', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['open_loop', 'salience_band']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockRejectedValue(new Error('decision engine down'))
    getDbMock.mockReturnValue(standardDbQueue())
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(
      /enforced bounded decision\(s\) failed.*decision engine down/,
    )
    expect(markEnrichQueueFailedMock).toHaveBeenCalledWith(
      't1',
      expect.stringContaining('decision engine down'),
    )
    // No fallback path: the pipeline never reached persist/enrich.
    expect(enrichThoughtMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('entity_type enforcement off: the bundle graph passes through and no decision call runs', async () => {
    // beforeEach defaults: nothing enforced, decision-model config absent.
    getDbMock.mockReturnValue(standardDbQueue())
    loadEnrichmentContextMock.mockResolvedValue({
      ...baseContext,
      ontology: {
        ...baseContext.ontology,
        entityKinds: [
          {
            id: 'ek-p',
            key: 'person',
            name: 'Person',
            definition: 'A human being',
            active: true,
            kindType: 'entity_type',
            neverStale: false,
          },
        ],
      },
    })
    extractEnrichThoughtBundleMock.mockResolvedValue({
      ...baseBundle,
      entityGraph: {
        mentions: [{ surface: 'Jonas', entityType: 'person', confidence: 0.8 }],
        triples: [],
      },
    })

    await enrichQueuedThought('u1', 't1')

    expect(runDecisionModelMock).not.toHaveBeenCalled()
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

  describe('user facts (docs/planning/user-facts-layer.md, F1)', () => {
    it('derives the facts of the enriched thought as the last step: its own text, the reference note, the capture time and the embedding enrichment already made', async () => {
      applyCaptureContentSplitIfNeededMock.mockResolvedValue({
        rawText: 'Email to Prof. Lee',
        enrichRawText: 'Email to Prof. Lee',
        normalizedText: 'Email to Prof. Lee about the keynote',
        role: 'reference' as const,
        attachedFileId: 'file-1',
        childThoughtIds: [],
      })
      loadEnrichmentContextMock.mockResolvedValue({
        ...baseContext,
        normalizedText: 'Email to Prof. Lee about the keynote',
      })
      getDbMock.mockReturnValue(standardDbQueue())

      await enrichQueuedThought('u1', 't1')

      expect(deriveUserFactsMock).toHaveBeenCalledTimes(1)
      expect(deriveUserFactsMock).toHaveBeenCalledWith({
        userId: 'u1',
        thoughtId: 't1',
        text: 'Email to Prof. Lee about the keynote',
        attachedFileId: 'file-1',
        capturedAt: baseRow.createdAt,
        queryEmbedding: [0.1, 0.2],
      })
      // after enrichment, so the extractor can see the people the graph linked to this thought
      expect(enrichThoughtMock.mock.invocationCallOrder[0]).toBeLessThan(
        deriveUserFactsMock.mock.invocationCallOrder[0]!,
      )
      expect(markEnrichQueueCompleteMock).toHaveBeenCalledWith('t1')
    })

    it('hands over redacted text only (a credential in the capture never reaches the extractor)', async () => {
      const raw = `token ${FAKE_SECRETS.githubClassic} for deploy, and I swim daily`
      getDbMock.mockReturnValue(
        makeDb([
          [{ ...baseRow, rawText: raw, normalizedText: raw }],
          [{ metadata: {}, metadataEncrypted: null }],
          [{ n: 5 }],
          [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
          [{ normalizedText: 'x', category: 'idea', enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
        ]),
      )
      applyCaptureContentSplitIfNeededMock.mockImplementation(
        async ({ existingNormalizedText }: { existingNormalizedText: string }) => ({
          rawText: existingNormalizedText,
          enrichRawText: existingNormalizedText,
          normalizedText: existingNormalizedText,
          role: 'personal' as const,
          attachedFileId: null,
          childThoughtIds: [],
        }),
      )

      await enrichQueuedThought('u1', 't1')

      expect(leaks(JSON.stringify(deriveUserFactsMock.mock.calls))).toBe(false)
    })

    it('a failure while deriving fails the enrich loudly: no silent success without facts', async () => {
      deriveUserFactsMock.mockRejectedValue(new Error('user fact extraction: response is not valid JSON'))
      getDbMock.mockReturnValue(standardDbQueue())
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/user fact extraction/)
      expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', expect.stringContaining('user fact extraction'))
      expect(markEnrichQueueCompleteMock).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })

  describe('forget requests at capture (S2, capture_intent)', () => {
    const FORGET_AT = baseRow.createdAt
    const FORGET_APPLIED = {
      status: 'applied',
      archived: ['x'],
      edited: [],
      notesArchived: [],
      notesEdited: [],
      unresolved: [],
      instruction: 'archived',
    }
    const FORGET_KEPT = {
      status: 'unresolved',
      archived: [],
      edited: [],
      notesArchived: [],
      notesEdited: [],
      unresolved: [{ kind: 'thought', id: 'u-1' }],
      instruction: 'kept',
    }

    function forgetInstructionPersisted(): unknown[] {
      return encryptTenantValueMock.mock.calls
        .map((c) => c[0] as { column?: string; plaintext?: string })
        .filter((a) => a.column === 'metadata' && a.plaintext?.includes('forgetInstruction'))
        .map((a) => JSON.parse(a.plaintext ?? '{}').forgetInstruction)
    }

    function intentDb(opts: {
      text?: string
      metadata?: Record<string, unknown>
      store?: boolean
      /** A forget capture that stays an active thought: its marker is persisted before the pipeline. */
      keptForget?: boolean
    }) {
      const row = {
        ...baseRow,
        rawText: opts.text ?? baseRow.rawText,
        normalizedText: opts.text ?? baseRow.normalizedText,
        ...(opts.metadata
          ? { metadata: { encrypted: true }, metadataEncrypted: `enc:${JSON.stringify(opts.metadata)}` }
          : {}),
      }
      const decidedNow = opts.metadata?.captureIntent === undefined
      return makeDb([
        [row],
        ...(decidedNow ? [[{ metadata: {}, metadataEncrypted: null }]] : []), // persist captureIntent
        ...(opts.keptForget ? [[{ metadata: {}, metadataEncrypted: null }]] : []), // persist forgetInstruction
        ...(opts.store
          ? [
              [{ metadata: {}, metadataEncrypted: null }], // classify/embed patch
              [{ n: 5 }],
              [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
            ]
          : []),
        [{ normalizedText: 'x', category: 'idea', enrichedAt: opts.store ? new Date() : null }],
      ])
    }

    function intentPersisted(): unknown[] {
      return encryptTenantValueMock.mock.calls
        .map((c) => c[0] as { column?: string; plaintext?: string })
        .filter((a) => a.column === 'metadata' && a.plaintext?.includes('captureIntent'))
        .map((a) => JSON.parse(a.plaintext ?? '{}').captureIntent)
    }

    beforeEach(() => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['capture_intent']))
      resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
      applyForgetRequestMock.mockResolvedValue(FORGET_APPLIED)
    })

    it('forget: the early call asks capture_intent, the forget is applied against EARLIER thoughts and nothing is enriched', async () => {
      runDecisionModelMock.mockResolvedValueOnce(
        decisionResponse({ capture_intent: { choice: 'forget', probabilities: { forget: 0.95, store: 0.05 } } }),
      )
      const db = intentDb({ text: 'Please forget that I like surfing' })
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      expect(runDecisionModelMock).toHaveBeenCalledTimes(1)
      expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions)).toEqual(['capture_intent'])
      expect(applyForgetRequestMock).toHaveBeenCalledWith({
        userId: 'u1',
        captureThoughtId: 't1',
        captureCreatedAt: FORGET_AT,
        request: 'Please forget that I like surfing',
      })
      expect(intentPersisted()).toEqual(['forget'])
      // a forget capture is not memory: no split, no embedding, no enrichment, no notify
      expect(applyCaptureContentSplitIfNeededMock).not.toHaveBeenCalled()
      expect(createThoughtEmbeddingMock).not.toHaveBeenCalled()
      expect(extractEnrichThoughtBundleMock).not.toHaveBeenCalled()
      expect(enrichThoughtMock).not.toHaveBeenCalled()
      expect(notifyThoughtEnrichedMock).not.toHaveBeenCalled()
      expect(markEnrichQueueCompleteMock).toHaveBeenCalledWith('t1')
    })

    it('S2b: an instruction that is kept (something unresolved / nothing found) is recorded on the thought and then stored like any thought, so Ask sees the request', async () => {
      runDecisionModelMock
        .mockResolvedValueOnce(
          decisionResponse({ capture_intent: { choice: 'forget', probabilities: { forget: 0.95, store: 0.05 } } }),
        )
        .mockResolvedValue(
          decisionResponse({
            category: { choice: 'task', probabilities: { task: 0.7 } },
            content_role: { choice: 'personal', probabilities: { personal: 1 } },
          }),
        )
      applyForgetRequestMock.mockResolvedValue(FORGET_KEPT)
      getDbMock.mockReturnValue(intentDb({ text: 'Please forget that I like surfing', store: true, keptForget: true }))

      await enrichQueuedThought('u1', 't1')

      expect(applyForgetRequestMock).toHaveBeenCalledTimes(1)
      expect(forgetInstructionPersisted()).toEqual([
        { status: 'unresolved', unresolved: [{ kind: 'thought', id: 'u-1' }] },
      ])
      // the instruction is memory now: split, embed, enrich, notify
      expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledTimes(1)
      expect(enrichThoughtMock).toHaveBeenCalledTimes(1)
      // ...but a request to forget is an instruction, never a fact about the user
      expect(deriveUserFactsMock).not.toHaveBeenCalled()
    })

    it('S2b: an archived instruction (everything removed) records no marker and is not enriched', async () => {
      runDecisionModelMock.mockResolvedValueOnce(
        decisionResponse({ capture_intent: { choice: 'forget', probabilities: { forget: 0.95, store: 0.05 } } }),
      )
      getDbMock.mockReturnValue(intentDb({ text: 'Please forget that I like surfing' }))

      await enrichQueuedThought('u1', 't1')

      expect(forgetInstructionPersisted()).toEqual([])
      expect(enrichThoughtMock).not.toHaveBeenCalled()
      expect(deriveUserFactsMock).not.toHaveBeenCalled()
    })

    it('S2b: a retried attempt of a kept instruction does not apply the forget request a second time and continues the pipeline', async () => {
      getDbMock.mockReturnValue(
        intentDb({
          text: 'Please forget that I like surfing',
          metadata: {
            captureIntent: 'forget',
            forgetInstruction: { status: 'nothing_found', unresolved: [] },
          },
          store: true,
        }),
      )
      runDecisionModelMock.mockResolvedValue(
        decisionResponse({
          category: { choice: 'task', probabilities: { task: 0.7 } },
          content_role: { choice: 'personal', probabilities: { personal: 1 } },
        }),
      )

      await enrichQueuedThought('u1', 't1')

      expect(runDecisionModelMock.mock.calls.every(([, req]) => !('capture_intent' in req.questions))).toBe(true)
      expect(applyForgetRequestMock).not.toHaveBeenCalled()
      expect(enrichThoughtMock).toHaveBeenCalledTimes(1)
      // the retried kept instruction still yields no facts
      expect(deriveUserFactsMock).not.toHaveBeenCalled()
    })

    it('regression: a capture merely MENTIONING forgetting ("I forgot my keys") is store and runs the normal pipeline', async () => {
      runDecisionModelMock.mockResolvedValueOnce(
        decisionResponse({ capture_intent: { choice: 'store', probabilities: { store: 0.97, forget: 0.03 } } }),
      )
      const db = intentDb({ text: 'I forgot my keys', store: true })
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      expect(applyForgetRequestMock).not.toHaveBeenCalled()
      expect(intentPersisted()).toEqual(['store'])
      expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledTimes(1)
      expect(deriveUserFactsMock).toHaveBeenCalledTimes(1)
      expect(enrichThoughtMock).toHaveBeenCalledTimes(1)
    })

    it('asks capture_intent together with content_role in the same early call', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set(['capture_intent', 'content_role']))
      runDecisionModelMock
        .mockResolvedValueOnce(
          decisionResponse({
            capture_intent: { choice: 'store', probabilities: { store: 0.9, forget: 0.1 } },
            content_role: { choice: 'personal', probabilities: { personal: 0.8, reference: 0.1, mixed: 0.1 } },
          }),
        )
        .mockResolvedValue(decisionResponse({ category: { choice: 'task', probabilities: { task: 0.7 } } }))
      getDbMock.mockReturnValue(intentDb({ text: 'I forgot my keys', store: true }))

      await enrichQueuedThought('u1', 't1')

      expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions).sort()).toEqual([
        'capture_intent',
        'content_role',
      ])
      expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
        expect.objectContaining({ decidedRole: 'personal' }),
      )
    })

    it('a retried attempt resumes the persisted intent without asking again', async () => {
      getDbMock.mockReturnValue(
        intentDb({ text: 'Please forget that I like surfing', metadata: { captureIntent: 'forget' } }),
      )

      await enrichQueuedThought('u1', 't1')

      expect(runDecisionModelMock).not.toHaveBeenCalled()
      expect(applyForgetRequestMock).toHaveBeenCalledTimes(1)
    })

    it('a span child asks no capture_intent question and never forgets', async () => {
      runDecisionModelMock.mockResolvedValue(
        decisionResponse({ category: { choice: 'task', probabilities: { task: 0.7 } } }),
      )
      getDbMock.mockReturnValue(
        makeDb([
          [{ ...baseRow, metadata: { encrypted: true }, metadataEncrypted: `enc:${JSON.stringify({ splitFrom: 'p' })}` }],
          [{ metadata: {}, metadataEncrypted: null }],
          [{ n: 5 }],
          [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
          [{ normalizedText: 'x', category: 'idea', enrichedAt: new Date() }],
        ]),
      )

      await enrichQueuedThought('u1', 'child-1')

      for (const [, req] of runDecisionModelMock.mock.calls) {
        expect(Object.keys(req.questions)).not.toContain('capture_intent')
      }
      expect(applyForgetRequestMock).not.toHaveBeenCalled()
    })

    it('a failure while forgetting fails the enrich loudly (no silent store, no partial success)', async () => {
      runDecisionModelMock.mockResolvedValueOnce(
        decisionResponse({ capture_intent: { choice: 'forget', probabilities: { forget: 0.95, store: 0.05 } } }),
      )
      applyForgetRequestMock.mockRejectedValue(new Error('gateway 502'))
      getDbMock.mockReturnValue(intentDb({ text: 'Please forget that I like surfing' }))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/gateway 502/)
      expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', expect.stringContaining('gateway 502'))
      expect(enrichThoughtMock).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('an off-catalog intent fails the enrich loudly', async () => {
      runDecisionModelMock.mockResolvedValueOnce(
        decisionResponse({ capture_intent: { choice: 'erase', probabilities: { erase: 1 } } }),
      )
      getDbMock.mockReturnValue(intentDb({ text: 'x' }))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/off-catalog choice "erase"/)
      expect(applyForgetRequestMock).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('shadow only (not enforced): the later call carries capture_intent, the pipeline stays store and forgets nothing', async () => {
      resolveEnforceKindsMock.mockReturnValue(new Set())
      runDecisionModelMock.mockResolvedValue(
        decisionResponse({
          category: { choice: 'task', probabilities: { task: 0.7 } },
          content_role: { choice: 'personal', probabilities: { personal: 1 } },
          capture_intent: { choice: 'forget', probabilities: { forget: 0.9, store: 0.1 } },
        }),
      )
      getDbMock.mockReturnValue(standardDbQueue())

      await enrichQueuedThought('u1', 't1')

      expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions)).toContain('capture_intent')
      expect(applyForgetRequestMock).not.toHaveBeenCalled()
      expect(enrichThoughtMock).toHaveBeenCalledTimes(1)
    })
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
        precomputedRecall: {
          cues: ['cue one', 'cue two'],
          askQuestion: 'What did I capture about the raw input?',
        },
      }),
    )
    // AC-7: the question rides the single bundle call — no extra LLM call for it.
    expect(extractEnrichThoughtBundleMock).toHaveBeenCalledTimes(1)
    expect(extractEnrichThoughtBundleMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: baseContext }),
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
        enrichRawText: rawText,
        normalizedText: 'secret normalized',
        role: 'personal' as const,
        attachedFileId: null,
        childThoughtIds: [],
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

  it('passes a zero-mention bundle through unchanged — no entity-only second extraction', async () => {
    const db = makeDb([
      [baseRow],
      [{ metadata: {}, metadataEncrypted: null }],
      [{ n: 1 }],
      [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
    ])
    getDbMock.mockReturnValue(db)
    loadEnrichmentContextMock.mockResolvedValue({
      ...baseContext,
      normalizedText: 'x'.repeat(200),
      ontology: { entityKinds: [{ key: 'person', active: true, kindType: 'entity_type' }] },
    })
    loadEntityGraphEnrichmentContextMock.mockResolvedValue({
      communityExcerpts: [],
      graphEntities: [],
    })

    await enrichQueuedThought('u1', 't1')

    expect(enrichThoughtMock).toHaveBeenCalledWith(
      'u1',
      't1',
      expect.any(String),
      expect.objectContaining({ precomputedEntityGraph: { mentions: [], triples: [] } }),
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
