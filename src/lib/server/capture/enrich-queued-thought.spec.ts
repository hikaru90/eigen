import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  enqueueUserJobMock,
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
  enqueueUserJobMock: vi.fn(),
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
vi.mock('$lib/server/ingest/retry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/ingest/retry')>()),
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
vi.mock('$lib/server/activity/log-call', () => ({
  logActivityCall: logActivityCallMock,
}))
// The capture review is real here (parts builder + upsert against the DB stub); only the job queue is faked.
vi.mock('$lib/server/job-queue/enqueue', () => ({ enqueueUserJob: enqueueUserJobMock }))
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

import { captureReview } from '$lib/server/db/schema'
import { runEnforcedPerItemDecisions } from '$lib/server/llm/decision-plane'
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
  // capture_review is upserted (insert ... on conflict); every other table is a plain insert.
  const reviewConflict = vi.fn(async (_config: unknown) => undefined)
  const reviewValues = vi.fn((_values: unknown) => ({ onConflictDoUpdate: reviewConflict }))
  const insert = vi.fn((table: unknown) =>
    table === captureReview ? { values: reviewValues } : { values: insertValues },
  )
  return {
    select,
    update,
    updateSet,
    updateWhere,
    insert,
    insertValues,
    reviewValues,
    reviewConflict,
  }
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
        normalizedText: rawText,
        split: {
          mode: 'thought_only' as const,
          thoughtText: rawText,
          attachmentTitle: '',
          attachmentBody: '',
          rationale: '',
        },
        attachedFileId: null,
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
    enqueueUserJobMock.mockResolvedValue({ enqueued: true, jobId: 'job-1' })
  })

  function decisionResponse(answers: Record<string, { choice: string; probabilities: Record<string, number> }>) {
    return {
      model: 'typesafe/jev-1.13',
      answers: Object.fromEntries(
        Object.entries(answers).map(([id, a]) => [
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 0.8, split: 0.2 } },
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 1 } },
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

  it('enforced content_role: the early call decides the mode and the split call receives it', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['content_role']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock
      .mockResolvedValueOnce(
        decisionResponse({
          content_role: { choice: 'split', probabilities: { split: 0.9, thought_only: 0.1 } },
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

    // Two Decisions calls: early content_role, then main shadow (category only —
    // content_role is excluded because the early call already decided it).
    expect(runDecisionModelMock).toHaveBeenCalledTimes(2)
    expect(Object.keys(runDecisionModelMock.mock.calls[0][1].questions)).toEqual(['content_role'])
    expect(Object.keys(runDecisionModelMock.mock.calls[1][1].questions)).toEqual(['category'])

    expect(applyCaptureContentSplitIfNeededMock).toHaveBeenCalledWith(
      expect.objectContaining({ decidedMode: 'split' }),
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
          content_role: { choice: 'thought_only', probabilities: { thought_only: 0.8, split: 0.2 } },
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
      expect.objectContaining({ decidedMode: 'thought_only' }),
    )
    expect(db.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'idea', ontologyEntityKindId: 'ek-idea' }),
    )
    expect(metadataPatchCalls()[0]).toMatchObject({ categorySource: 'decision_model' })
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 0.8, split: 0.2 } },
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 0.8, split: 0.2 } },
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 1 } },
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 1 } },
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 1 } },
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
        content_role: { choice: 'thought_only', probabilities: { thought_only: 1 } },
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
        normalizedText: 'secret normalized',
        split: {
          mode: 'thought_only' as const,
          thoughtText: 'secret normalized',
          attachmentTitle: '',
          attachmentBody: '',
          rationale: '',
        },
        attachedFileId: null,
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

  describe('capture review at the end of enrichment', () => {
    const personEntityKind = {
      id: 'ek-p',
      key: 'person',
      name: 'Person',
      definition: 'A human being',
      active: true,
      kindType: 'entity_type',
      neverStale: false,
    }

    /** One answer per question id, keyed exactly like the real calls (`entity_type:m1`, ...). */
    const JEV_ANSWERS: Record<string, { choice: string; probabilities: Record<string, number> }> = {
      content_role: { choice: 'thought_only', probabilities: { thought_only: 0.8, split: 0.2 } },
      category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
      'entity_type:m1': { choice: 'person', probabilities: { person: 0.82 } },
      'temporal_kind:t1': { choice: 'deadline', probabilities: { deadline: 0.74, reminder: 0.26 } },
      open_loop: { choice: 'actionable', probabilities: { actionable: 0.5, closed: 0.5 } },
      salience_band: { choice: 'high', probabilities: { high: 0.45, low: 0.55 } },
    }

    function fakeJev() {
      runDecisionModelMock.mockImplementation(
        async (_config: unknown, request: { questions: Record<string, unknown> }) =>
          decisionResponse(
            Object.fromEntries(Object.keys(request.questions).map((id) => [id, JEV_ANSWERS[id]])),
          ),
      )
    }

    function enforceEverything() {
      resolveEnforceKindsMock.mockReturnValue(
        new Set([
          'category',
          'content_role',
          'entity_type',
          'temporal_kind',
          'open_loop',
          'salience_band',
        ]),
      )
      resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
      fakeJev()
      loadEnrichmentContextMock.mockResolvedValue({
        ...baseContext,
        ontology: { ...baseContext.ontology, entityKinds: [personEntityKind] },
      })
      loadEntityGraphEnrichmentContextMock.mockResolvedValue({
        communityExcerpts: [],
        graphEntities: [],
      })
      extractEnrichThoughtBundleMock.mockResolvedValue({
        ...baseBundle,
        entityGraph: {
          mentions: [{ surface: 'Anna', entityType: 'person', confidence: 0.8 }],
          triples: [],
        },
      })
      // Temporal kinds are decided inside enrichThought (a different file): the recorder must follow.
      enrichThoughtMock.mockImplementation(async () => {
        await runEnforcedPerItemDecisions({
          userId: 'u1',
          surface: 'enrich_queued',
          kind: 'temporal_kind',
          state: 'raw input',
          criteria: { deadline: 'A date by which something must be done.', reminder: 'A note.' },
          items: [{ ref: 't1', instructions: 'Which kind is "Friday"?', llmChoice: 'reminder' }],
        })
      })
    }

    it('records a pending_audit review with the enforced Jev decisions and queues one audit job', async () => {
      enforceEverything()
      const db = standardDbQueue()
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      expect(db.reviewValues).toHaveBeenCalledTimes(1)
      expect(db.reviewValues).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          thoughtId: 't1',
          score: null,
          status: 'pending_audit',
          auditError: null,
          // content_role (early), entity_type (before settle), category (settle), temporal_kind
          // (inside enrichThought). open_loop and salience_band are decided too but not reviewed.
          parts: [
            {
              part: 'content_role',
              ref: 'content_role',
              engine: 'jev_decision',
              label: 'thought_only',
              probability: 0.8,
            },
            {
              part: 'entity_type',
              ref: 'm1',
              engine: 'jev_decision',
              label: 'person',
              probability: 0.82,
            },
            {
              part: 'category',
              ref: 'category',
              engine: 'jev_decision',
              label: 'idea',
              probability: 0.6,
            },
            {
              part: 'temporal_kind',
              ref: 't1',
              engine: 'jev_decision',
              label: 'deadline',
              probability: 0.74,
            },
          ],
        }),
      )

      expect(enqueueUserJobMock).toHaveBeenCalledTimes(1)
      expect(enqueueUserJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          jobType: 'capture_review_audit',
          payload: { thoughtId: 't1' },
          maxAttempts: 4,
        }),
      )
    })

    it('holds no user text in the review it writes', async () => {
      enforceEverything()
      const db = standardDbQueue()
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      const written = JSON.stringify([
        db.reviewValues.mock.calls,
        db.reviewConflict.mock.calls.map((call) => (call[0] as { set: unknown }).set),
      ])
      expect(written).not.toContain('Anna')
      expect(written).not.toContain('raw input')
      expect(written).not.toContain('Friday')
    })

    it('writes the review after the queue row is complete and the enriched notification went out', async () => {
      enforceEverything()
      const db = standardDbQueue()
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      const reviewOrder = db.reviewValues.mock.invocationCallOrder[0]
      expect(markEnrichQueueCompleteMock.mock.invocationCallOrder[0]).toBeLessThan(reviewOrder)
      expect(notifyThoughtEnrichedMock.mock.invocationCallOrder[0]).toBeLessThan(reviewOrder)
    })

    it('records a review with no parts when Jev decided nothing (the audit still scores it)', async () => {
      const db = standardDbQueue()
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      expect(db.reviewValues).toHaveBeenCalledWith(
        expect.objectContaining({ parts: [], status: 'pending_audit' }),
      )
      expect(enqueueUserJobMock).toHaveBeenCalledTimes(1)
    })

    it('upserts on the thought and leaves the vote columns alone', async () => {
      enforceEverything()
      const db = standardDbQueue()
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      const config = db.reviewConflict.mock.calls[0][0] as {
        target: { name: string }
        set: Record<string, unknown>
      }
      expect(config.target.name).toBe('thought_id')
      expect(Object.keys(config.set).sort()).toEqual([
        'auditError',
        'parts',
        'score',
        'status',
        'updatedAt',
      ])
      expect(config.set).toMatchObject({ score: null, status: 'pending_audit', auditError: null })
    })

    it('re-enrichment upserts the same thought again with fresh parts (no second row, no accumulation)', async () => {
      enforceEverything()
      const first = standardDbQueue()
      getDbMock.mockReturnValue(first)
      await enrichQueuedThought('u1', 't1')

      JEV_ANSWERS.category = { choice: 'task', probabilities: { task: 0.9, idea: 0.1 } }
      const second = standardDbQueue()
      getDbMock.mockReturnValue(second)
      try {
        await enrichQueuedThought('u1', 't1')
      } finally {
        JEV_ANSWERS.category = { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } }
      }

      const firstParts = (first.reviewConflict.mock.calls[0][0] as { set: { parts: unknown[] } })
        .set.parts
      const secondParts = (second.reviewConflict.mock.calls[0][0] as { set: { parts: unknown[] } })
        .set.parts
      expect(secondParts).toHaveLength(firstParts.length)
      expect(secondParts).toContainEqual(
        expect.objectContaining({ part: 'category', label: 'task', probability: 0.9 }),
      )
      expect(secondParts).not.toContainEqual(
        expect.objectContaining({ part: 'category', label: 'idea' }),
      )
      expect(enqueueUserJobMock).toHaveBeenCalledTimes(2)
    })

    it('keeps only the decisions of the attempt that succeeded when the ladder retried', async () => {
      enforceEverything()
      // First attempt: content_role is decided (0.8), then the bundle call fails. Second attempt succeeds.
      extractEnrichThoughtBundleMock.mockRejectedValueOnce(new Error('bundle timeout'))
      runIngestWithRetriesMock.mockImplementation(async (op: () => Promise<unknown>) => {
        try {
          return await op()
        } catch {
          return op()
        }
      })
      // The retry needs the row lookups again.
      const db = makeDb([
        [baseRow],
        [baseRow],
        [{ metadata: {}, metadataEncrypted: null }],
        [{ n: 5 }],
        [{ enrichedAt: new Date('2026-06-01T00:05:00.000Z') }],
        [
          {
            normalizedText: 'raw input',
            category: 'idea',
            enrichedAt: new Date('2026-06-01T00:05:00.000Z'),
          },
        ],
      ])
      getDbMock.mockReturnValue(db)

      await enrichQueuedThought('u1', 't1')

      expect(db.reviewValues).toHaveBeenCalledTimes(1)
      const parts = (db.reviewValues.mock.calls[0][0] as { parts: Array<{ part: string }> }).parts
      expect(parts.map((p) => p.part)).toEqual([
        'content_role',
        'entity_type',
        'category',
        'temporal_kind',
      ])
      expect(enqueueUserJobMock).toHaveBeenCalledTimes(1)
    })

    it('writes no review and queues no audit when the enrichment itself fails', async () => {
      const db = makeDb([[baseRow]])
      getDbMock.mockReturnValue(db)
      applyCaptureContentSplitIfNeededMock.mockRejectedValue(new Error('split failed'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow('split failed')

      expect(db.reviewValues).not.toHaveBeenCalled()
      expect(enqueueUserJobMock).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('fails loudly when the review cannot be written: the review step has its own retry ladder, the queue row is marked failed', async () => {
      const db = standardDbQueue()
      db.reviewConflict.mockRejectedValue(new Error('relation "capture_review" does not exist'))
      getDbMock.mockReturnValue(db)
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow(/capture_review/)

      // The enrichment result is already persisted and the row was completed first ...
      expect(enrichThoughtMock).toHaveBeenCalled()
      expect(markEnrichQueueCompleteMock).toHaveBeenCalledWith('t1')
      // ... the review step has its own ladder (the ingest policy), then the failure is surfaced.
      expect(runIngestWithRetriesMock).toHaveBeenCalledTimes(2)
      expect(markEnrichQueueFailedMock).toHaveBeenCalledWith(
        't1',
        expect.stringContaining('capture_review'),
      )
      expect(enqueueUserJobMock).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('fails loudly when the audit job cannot be enqueued', async () => {
      const db = standardDbQueue()
      getDbMock.mockReturnValue(db)
      enqueueUserJobMock.mockRejectedValue(new Error('job queue unavailable'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(enrichQueuedThought('u1', 't1')).rejects.toThrow('job queue unavailable')

      expect(markEnrichQueueFailedMock).toHaveBeenCalledWith('t1', 'job queue unavailable')
      errorSpy.mockRestore()
    })
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
