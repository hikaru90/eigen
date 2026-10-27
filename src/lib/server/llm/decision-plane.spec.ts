import type { DecisionShadowConfig } from './decision-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dominantEntityType,
  runEnforcedBoundedDecisions,
  runEnforcedPerItemDecisions,
  startEarlyCaptureDecisions,
  startDecisionShadow,
  type BoundedDecisionSpec,
  type DecisionShadowContext,
  type DecisionShadowPrimaries,
  type PerItemDecisionItem,
} from './decision-plane'

const dbMocks = vi.hoisted(() => ({
  insertValues: vi.fn(async () => undefined),
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    insert: () => ({ values: dbMocks.insertValues }),
  }),
}))

const logActivityCallMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('$lib/server/activity/log-call', () => ({
  logActivityCall: logActivityCallMock,
}))

const resolveConfigMock = vi.hoisted(() => vi.fn())
const resolveEnforceMock = vi.hoisted(() => vi.fn())
const runDecisionMock = vi.hoisted(() => vi.fn())
vi.mock('./decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./decision-client')>()
  return {
    ...actual,
    resolveDecisionShadowConfig: resolveConfigMock,
    resolveDecisionEnforceKinds: resolveEnforceMock,
    runDecisionModel: runDecisionMock,
  }
})

const CATEGORY_KINDS = [
  { key: 'task', name: 'Task', definition: 'Something to do' },
  { key: 'idea', name: 'Idea', definition: 'An idea' },
]

const ENTITY_TYPE_KINDS = [
  { key: 'person', name: 'Person', definition: 'A human being' },
  { key: 'technology', name: 'Technology', definition: 'A software tool or system' },
]

function makeContext(overrides?: Partial<DecisionShadowContext>): DecisionShadowContext {
  return {
    userId: 'user-1',
    surface: 'capture_service',
    state: 'Buy milk tomorrow',
    categoryKinds: CATEGORY_KINDS,
    ...overrides,
  }
}

/** Enrich-plane context: all three bounded questions enabled. */
function makeEnrichContext(overrides?: Partial<DecisionShadowContext>): DecisionShadowContext {
  return makeContext({
    surface: 'enrich_queued',
    entityTypeKinds: ENTITY_TYPE_KINDS,
    contentRoleEnabled: true,
    ...overrides,
  })
}

function enrichPrimaries(overrides?: Partial<DecisionShadowPrimaries>): DecisionShadowPrimaries {
  return {
    category: { choice: 'task', confidence: 0.95 },
    contentRole: { choice: 'personal' },
    entityType: { choice: 'technology', confidence: 0.7 },
    ...overrides,
  }
}

const config: DecisionShadowConfig = { apiKey: 'sk-or-v1-test', model: 'typesafe/jev-1.13' }

function choiceAnswers(
  answers: Record<string, { choice: string; probabilities: Record<string, number>; confidence?: number }>,
) {
  return {
    model: 'typesafe/jev-1.13',
    answers: Object.fromEntries(
      Object.entries(answers).map(([id, a]) => [
        id,
        { type: 'choice' as const, choice: a.choice, probabilities: a.probabilities, confidence: a.confidence ?? 0.8 },
      ]),
    ),
    usage: { cost: 0.0000421, input_tokens: 5, output_tokens: 1 },
    reportedCostUsd: 0.0000421,
  }
}

function allAnswersResponse() {
  return choiceAnswers({
    category: { choice: 'task', probabilities: { task: 0.51, idea: 0.49 }, confidence: 0.39 },
    content_role: { choice: 'personal', probabilities: { personal: 0.8, reference: 0.15, mixed: 0.05 } },
    entity_type: { choice: 'technology', probabilities: { technology: 0.7, person: 0.3 } },
  })
}

function insertedRows(): Record<string, unknown>[] {
  // Drizzle multi-row insert: one values() call carrying all kind rows.
  return dbMocks.insertValues.mock.calls.flatMap((c) => c[0] as Record<string, unknown>[])
}

beforeEach(() => {
  dbMocks.insertValues.mockReset()
  dbMocks.insertValues.mockResolvedValue(undefined)
  logActivityCallMock.mockReset()
  logActivityCallMock.mockResolvedValue(undefined)
  runDecisionMock.mockReset()
  resolveEnforceMock.mockReset()
  resolveEnforceMock.mockReturnValue(new Set())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('startDecisionShadow', () => {
  it('returns a no-op settle and writes nothing when shadow is disabled', async () => {
    resolveConfigMock.mockReturnValue(null)
    const settle = startDecisionShadow(makeEnrichContext())
    expect(settle).toBeNull()
    await Promise.resolve()
    expect(runDecisionMock).not.toHaveBeenCalled()
    expect(dbMocks.insertValues).not.toHaveBeenCalled()
    expect(logActivityCallMock).not.toHaveBeenCalled()
  })

  it('kicks ONE decision-model call immediately carrying ALL enabled questions', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startDecisionShadow(makeEnrichContext())
    expect(runDecisionMock).toHaveBeenCalledTimes(1)
    const [cfg, req] = runDecisionMock.mock.calls[0]
    expect(cfg).toEqual(config)
    expect(req.state).toBe('Buy milk tomorrow')
    expect(Object.keys(req.questions).sort()).toEqual(['category', 'content_role', 'entity_type'])
    expect(req.questions.category.criteria).toEqual({
      task: 'Task: Something to do',
      idea: 'Idea: An idea',
    })
    expect(req.questions.entity_type.criteria).toEqual({
      person: 'Person: A human being',
      technology: 'Technology: A software tool or system',
    })
    expect(Object.keys(req.questions.content_role.criteria)).toEqual(['personal', 'reference', 'mixed'])
    expect(req.questions.content_role.criteria).toEqual({
      personal: expect.stringMatching(/own account/),
      reference: expect.stringMatching(/linked note/),
      mixed: expect.stringMatching(/BOTH/),
    })
  })

  it('asks only the category question on the capture_service surface', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startDecisionShadow(makeContext())
    const [, req] = runDecisionMock.mock.calls[0]
    expect(Object.keys(req.questions)).toEqual(['category'])
  })

  it('writes one comparable row per decision kind on the enrich surface', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(makeEnrichContext())
    await settle?.(enrichPrimaries())

    const rows = insertedRows()
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.decisionKind).sort()).toEqual(['category', 'content_role', 'entity_type'])

    const categoryRow = rows.find((r) => r.decisionKind === 'category')
    expect(categoryRow).toMatchObject({
      userId: 'user-1',
      surface: 'enrich_queued',
      decisionKind: 'category',
      llmChoice: 'task',
      llmConfidence: 0.95,
      decisionChoice: 'task',
      decisionProbability: 0.51,
      decisionAlternatives: { idea: 0.49 },
      agree: true,
      decisionError: null,
    })

    const contentRoleRow = rows.find((r) => r.decisionKind === 'content_role')
    expect(contentRoleRow).toMatchObject({
      decisionKind: 'content_role',
      llmChoice: 'personal',
      llmConfidence: null,
      decisionChoice: 'personal',
      agree: true,
    })

    const entityTypeRow = rows.find((r) => r.decisionKind === 'entity_type')
    expect(entityTypeRow).toMatchObject({
      decisionKind: 'entity_type',
      llmChoice: 'technology',
      llmConfidence: 0.7,
      decisionChoice: 'technology',
      agree: true,
    })
  })

  it('records disagreement with the chosen option excluded from alternatives', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        category: { choice: 'idea', probabilities: { idea: 0.6, task: 0.4 } },
      }),
    )
    const settle = startDecisionShadow(makeContext())
    await settle?.({ category: { choice: 'task', confidence: 0.8 } })
    const row = insertedRows()[0]
    expect(row.agree).toBe(false)
    expect(row.decisionChoice).toBe('idea')
    expect(row.decisionAlternatives).toEqual({ task: 0.4 })
  })

  it('stores an off-catalog shadow choice verbatim with agree=false — never repairs (AC-S1-3)', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        category: { choice: 'totally_made_up_key', probabilities: { totally_made_up_key: 1 } },
      }),
    )
    const settle = startDecisionShadow(makeContext())
    await settle?.({ category: { choice: 'task', confidence: 0.9 } })
    const row = insertedRows()[0]
    expect(row.decisionChoice).toBe('totally_made_up_key')
    expect(row.agree).toBe(false)
  })

  it('writes one error row per enabled kind when the shadow call fails, without throwing (AC-S1-4)', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    const settle = startDecisionShadow(makeEnrichContext())
    await expect(settle?.(enrichPrimaries())).resolves.toEqual({})

    const rows = insertedRows()
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      expect(r.agree).toBeNull()
      expect(r.decisionChoice).toBeNull()
      expect(r.decisionError).toBe('502 bad gateway')
      expect(r.decisionProbability).toBeNull()
    }
    expect(rows.find((r) => r.decisionKind === 'category')?.llmChoice).toBe('task')
    expect(rows.find((r) => r.decisionKind === 'content_role')?.llmChoice).toBe('personal')
    expect(rows.find((r) => r.decisionKind === 'entity_type')?.llmChoice).toBe('technology')
  })

  it('records a misconfiguration as error rows without throwing into capture', async () => {
    resolveConfigMock.mockImplementation(() => {
      throw new Error('DECISION_SHADOW_ENABLED=true but missing env: OPENROUTER_API_KEY')
    })
    const settle = startDecisionShadow(makeContext())
    await expect(settle?.({ category: { choice: 'task', confidence: 0.7 } })).resolves.toEqual({})
    const row = insertedRows()[0]
    expect(row.agree).toBeNull()
    expect(row.decisionError).toContain('OPENROUTER_API_KEY')
  })

  it('skips the entity_type row when no dominant mention exists (no comparable pair)', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(makeEnrichContext())
    await settle?.(enrichPrimaries({ entityType: undefined }))
    const kinds = insertedRows().map((r) => r.decisionKind)
    expect(kinds.sort()).toEqual(['category', 'content_role'])
  })

  it('still resolves and logs loudly when the log insert itself fails', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    dbMocks.insertValues.mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const settle = startDecisionShadow(makeEnrichContext())
    await expect(settle?.(enrichPrimaries())).resolves.toEqual({})
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[decision-shadow]'), expect.anything())
  })

  it('attributes the provider-reported cost to EXACTLY ONE activity row per call', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(makeEnrichContext())
    await settle?.(enrichPrimaries())

    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    const [, userId, call] = logActivityCallMock.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(call.provider).toBe('openrouter')
    expect(call.operation).toBe('decision_shadow')
    expect(call.gatewayHost).toBe('openrouter.ai')
    // Full cost once — not once per decision kind.
    expect(call.baseCostUsd).toBe(0.0000421)
    expect(call.durationMs).toBeTypeOf('number')
  })

  it('stores metadata only — no thought text in any logged field (AC-S1-5)', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('network down'))
    const settle = startDecisionShadow(makeEnrichContext({ state: 'SECRET-THOUGHT-CONTENT' }))
    await settle?.(enrichPrimaries())
    const serialized = JSON.stringify(insertedRows())
    expect(serialized).not.toContain('SECRET-THOUGHT-CONTENT')
    expect(serialized).not.toContain('Buy milk tomorrow')
  })
})

describe('dominantEntityType', () => {
  it('returns null when there are no mentions', () => {
    expect(dominantEntityType([])).toBeNull()
  })

  it('picks the highest-confidence mention', () => {
    expect(
      dominantEntityType([
        { entityType: 'person', confidence: 0.4 },
        { entityType: 'technology', confidence: 0.9 },
      ]),
    ).toEqual({ choice: 'technology', confidence: 0.9 })
  })

  it('breaks confidence ties by first occurrence (deterministic)', () => {
    expect(
      dominantEntityType([
        { entityType: 'person', confidence: 0.5 },
        { entityType: 'technology', confidence: 0.5 },
      ]),
    ).toEqual({ choice: 'person', confidence: 0.5 })
  })
})

describe('enforcement — startEarlyCaptureDecisions content_role (early, pre-split call)', () => {
  const ENFORCED = new Set(['category', 'content_role'] as const)

  it('returns null when content_role is not enforced (today\u2019s shadow-only flow)', () => {
    resolveEnforceMock.mockReturnValue(new Set(['category'] as const))
    expect(startEarlyCaptureDecisions({ userId: 'user-1', state: 'text', contentRole: true, captureIntent: false })).toBeNull()
  })

  it('throws when enforced but the decision-model config is disabled', () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(null)
    expect(() => startEarlyCaptureDecisions({ userId: 'user-1', state: 'text', contentRole: true, captureIntent: false })).toThrow(
      /content_role/,
    )
  })

  it('asks ONLY the content_role question and kicks the call immediately', () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startEarlyCaptureDecisions({ userId: 'user-1', state: 'recipe text', contentRole: true, captureIntent: false })
    expect(runDecisionMock).toHaveBeenCalledTimes(1)
    const [, req] = runDecisionMock.mock.calls[0]
    expect(req.state).toBe('recipe text')
    expect(Object.keys(req.questions)).toEqual(['content_role'])
  })

  it('decide() resolves mode + probability + alternatives and logs exactly one activity row', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        content_role: { choice: 'reference', probabilities: { reference: 0.9, personal: 0.06, mixed: 0.04 } },
      }),
    )
    const handle = startEarlyCaptureDecisions({ userId: 'user-1', state: 'recipe text', contentRole: true, captureIntent: false })
    const decided = await handle!.decide()
    expect(decided.contentRole?.role).toBe('reference')
    expect(decided.contentRole?.probability).toBe(0.9)
    expect(decided.contentRole?.alternatives).toEqual({ personal: 0.06, mixed: 0.04 })
    expect(decided.contentRole?.durationMs).toBeTypeOf('number')
    expect(decided.captureIntent).toBeUndefined()
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    expect(logActivityCallMock.mock.calls[0][1]).toBe('user-1')
    expect(logActivityCallMock.mock.calls[0][2].baseCostUsd).toBe(0.0000421)
  })

  it('decide() throws on an off-catalog choice (fail loud, no repair)', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        content_role: { choice: 'both_somehow', probabilities: { both_somehow: 1 } },
      }),
    )
    const handle = startEarlyCaptureDecisions({ userId: 'user-1', state: 'text', contentRole: true, captureIntent: false })
    await expect(handle!.decide()).rejects.toThrow(/off-catalog choice "both_somehow"/)
  })

  it.each(['thought_only', 'split'])(
    'decide() rejects the retired %s choice — the vocabulary is personal | reference | mixed',
    async (retired) => {
      resolveEnforceMock.mockReturnValue(ENFORCED)
      resolveConfigMock.mockReturnValue(config)
      runDecisionMock.mockResolvedValue(
        choiceAnswers({ content_role: { choice: retired, probabilities: { [retired]: 1 } } }),
      )
      const handle = startEarlyCaptureDecisions({ userId: 'user-1', state: 'text', contentRole: true, captureIntent: false })
      await expect(handle!.decide()).rejects.toThrow(
        new RegExp(`off-catalog choice "${retired}"`),
      )
    },
  )

  it.each(['personal', 'reference', 'mixed'] as const)('decide() accepts %s', async (role) => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({ content_role: { choice: role, probabilities: { [role]: 0.7 } } }),
    )
    const decided = await startEarlyCaptureDecisions({ userId: 'user-1', state: 'text', contentRole: true, captureIntent: false })!.decide()
    expect(decided.contentRole?.role).toBe(role)
  })

  it('decide() throws when the call fails (into the ingest retry ladder)', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    const handle = startEarlyCaptureDecisions({ userId: 'user-1', state: 'text', contentRole: true, captureIntent: false })
    await expect(handle!.decide()).rejects.toThrow(/enforced content_role decision failed.*502/s)
  })
})

describe('enforcement — capture_intent in the early pre-split call', () => {
  const BOTH = new Set(['capture_intent', 'content_role'] as const)
  const INTENT_ONLY = new Set(['capture_intent'] as const)
  const intentAnswer = (choice: string, probs: Record<string, number>) => ({
    capture_intent: { choice, probabilities: probs },
  })

  it('asks capture_intent and content_role in ONE call when both are enforced', () => {
    resolveEnforceMock.mockReturnValue(BOTH)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startEarlyCaptureDecisions({ userId: 'user-1', state: 'Please forget my diet', contentRole: true, captureIntent: true })
    expect(runDecisionMock).toHaveBeenCalledTimes(1)
    const [, req] = runDecisionMock.mock.calls[0]
    expect(req.state).toBe('Please forget my diet')
    expect(Object.keys(req.questions).sort()).toEqual(['capture_intent', 'content_role'])
    expect(Object.keys(req.questions.capture_intent.criteria)).toEqual(['store', 'forget'])
  })

  it('asks only capture_intent when content_role is not requested or not enforced', () => {
    resolveEnforceMock.mockReturnValue(INTENT_ONLY)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: true, captureIntent: true })
    expect(Object.keys(runDecisionMock.mock.calls[0][1].questions)).toEqual(['capture_intent'])
  })

  it('returns null when capture_intent is requested but not enforced (shadow rides the later call)', () => {
    resolveEnforceMock.mockReturnValue(new Set(['category'] as const))
    expect(
      startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: false, captureIntent: true }),
    ).toBeNull()
  })

  it('does not ask capture_intent when the caller already has the intent (retry / span child)', () => {
    resolveEnforceMock.mockReturnValue(BOTH)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: true, captureIntent: false })
    expect(Object.keys(runDecisionMock.mock.calls[0][1].questions)).toEqual(['content_role'])
  })

  it('throws when enforced but the decision-model config is disabled', () => {
    resolveEnforceMock.mockReturnValue(INTENT_ONLY)
    resolveConfigMock.mockReturnValue(null)
    expect(() =>
      startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: false, captureIntent: true }),
    ).toThrow(/capture_intent/)
  })

  it('decide() returns the intent with its probability, logs ONE activity row and a metadata-only decision row', async () => {
    resolveEnforceMock.mockReturnValue(INTENT_ONLY)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers(intentAnswer('forget', { forget: 0.93, store: 0.07 })),
    )
    const decided = await startEarlyCaptureDecisions({
      userId: 'user-1',
      state: 'secret diet text',
      contentRole: false,
      captureIntent: true,
    })!.decide()

    expect(decided.captureIntent).toMatchObject({ intent: 'forget', probability: 0.93, alternatives: { store: 0.07 } })
    expect(decided.contentRole).toBeUndefined()
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    expect(logActivityCallMock.mock.calls[0][2].context).toContain('capture_intent')
    const rows = insertedRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: 'user-1',
      surface: 'enrich_queued',
      decisionKind: 'capture_intent',
      llmChoice: null,
      decisionChoice: 'forget',
      decisionProbability: 0.93,
      decisionAlternatives: { store: 0.07 },
      agree: null,
      decisionError: null,
      authoritativeEngine: 'decision_model',
    })
    expect(JSON.stringify(rows)).not.toContain('secret diet text')
  })

  it('decide() throws on an off-catalog intent (fail loud, no repair) and records the error row', async () => {
    resolveEnforceMock.mockReturnValue(INTENT_ONLY)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(choiceAnswers(intentAnswer('erase', { erase: 1 })))
    const handle = startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: false, captureIntent: true })
    await expect(handle!.decide()).rejects.toThrow(/off-catalog choice "erase"/)
    expect(insertedRows()[0]).toMatchObject({
      decisionKind: 'capture_intent',
      decisionChoice: null,
      decisionError: expect.stringContaining('erase'),
    })
  })

  it('decide() throws when the call fails (into the ingest retry ladder)', async () => {
    resolveEnforceMock.mockReturnValue(INTENT_ONLY)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    const handle = startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: false, captureIntent: true })
    await expect(handle!.decide()).rejects.toThrow(/enforced capture_intent decision failed.*502/s)
  })

  it('the criteria say forget = a request to Eigen, and that talk about forgetting is store', () => {
    resolveEnforceMock.mockReturnValue(INTENT_ONLY)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startEarlyCaptureDecisions({ userId: 'user-1', state: 't', contentRole: false, captureIntent: true })
    const q = runDecisionMock.mock.calls[0][1].questions.capture_intent
    expect(q.criteria.forget).toMatch(/asks Eigen to forget/)
    expect(q.criteria.store).toMatch(/forgot/)
    expect(q.instructions).toMatch(/not by whether/)
  })
})

describe('shadow — capture_intent beside the later generic call', () => {
  it('adds the question only when the context opts in; the pipeline behaviour (store) is the comparison', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        category: { choice: 'task', probabilities: { task: 0.51, idea: 0.49 } },
        capture_intent: { choice: 'forget', probabilities: { forget: 0.8, store: 0.2 } },
      }),
    )
    const settle = startDecisionShadow(makeContext({ captureIntentShadow: true }))
    expect(Object.keys(runDecisionMock.mock.calls[0][1].questions).sort()).toEqual(['capture_intent', 'category'])
    await settle?.({ category: { choice: 'task', confidence: 0.9 }, captureIntent: { choice: 'store' } })
    const row = insertedRows().find((r) => r.decisionKind === 'capture_intent')
    expect(row).toMatchObject({
      llmChoice: 'store',
      decisionChoice: 'forget',
      agree: false,
      authoritativeEngine: 'chat_judge',
    })
  })

  it('is absent by default', () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startDecisionShadow(makeContext())
    expect(Object.keys(runDecisionMock.mock.calls[0][1].questions)).toEqual(['category'])
  })
})

describe('enforcement — startDecisionShadow settle contract', () => {
  const ENFORCED = new Set(['category', 'content_role'] as const)

  function contentRoleContext(): DecisionShadowContext {
    return makeEnrichContext({
      enforcedContentRole: {
        role: 'personal',
        probability: 0.8,
        alternatives: { reference: 0.15, mixed: 0.05 },
        durationMs: 321,
      },
    })
  }

  it('throws when enforcement is configured but the shadow config resolves null', () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(null)
    expect(() => startDecisionShadow(makeEnrichContext())).toThrow(/DECISION_ENFORCE_KINDS/)
  })

  it('excludes the content_role question from the later call when enforced via the early call', () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startDecisionShadow(contentRoleContext())
    const [, req] = runDecisionMock.mock.calls[0]
    expect(Object.keys(req.questions).sort()).toEqual(['category', 'entity_type'])
  })

  it('returns the enforced category answer from settle and marks rows decision_model', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(contentRoleContext())
    const enforced = await settle!(enrichPrimaries())
    expect(enforced.category).toEqual({
      choice: 'task',
      probability: 0.51,
      alternatives: { idea: 0.49 },
    })

    const byKind = Object.fromEntries(insertedRows().map((r) => [r.decisionKind, r]))
    expect(byKind.category.authoritativeEngine).toBe('decision_model')
    expect(byKind.content_role.authoritativeEngine).toBe('decision_model')
    expect(byKind.entity_type.authoritativeEngine).toBe('chat_judge')
  })

  it('records the early content_role answer beside the chat primary when the split ran', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(contentRoleContext())
    await settle!(enrichPrimaries())

    const row = insertedRows().find((r) => r.decisionKind === 'content_role')
    expect(row).toMatchObject({
      llmChoice: 'personal',
      decisionChoice: 'personal',
      decisionProbability: 0.8,
      decisionAlternatives: { reference: 0.15, mixed: 0.05 },
      agree: true,
      authoritativeEngine: 'decision_model',
    })
    // Early-call duration, not the later call's.
    expect(row.decisionDurationMs).toBe(321)
  })

  it('writes a comparable-free row with null llmChoice when the split call was skipped', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(contentRoleContext())
    await settle!(enrichPrimaries({ contentRole: undefined }))

    const row = insertedRows().find((r) => r.decisionKind === 'content_role')
    expect(row).toMatchObject({
      llmChoice: null,
      llmConfidence: null,
      decisionChoice: 'personal',
      decisionProbability: 0.8,
      agree: null,
      decisionError: null,
      authoritativeEngine: 'decision_model',
    })
  })

  it('rejects settle when an enforced kind\u2019s answer failed — after error rows are written', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    const settle = startDecisionShadow(contentRoleContext())
    await expect(settle!(enrichPrimaries())).rejects.toThrow(/502 bad gateway/)

    // Evidence is not lost: the asked kinds still got their error rows.
    const kinds = insertedRows().map((r) => r.decisionKind).sort()
    expect(kinds).toEqual(['category', 'content_role', 'entity_type'])
    const categoryRow = insertedRows().find((r) => r.decisionKind === 'category')
    expect(categoryRow.decisionError).toBe('502 bad gateway')
    // The early-decided content_role is unaffected by the later call's failure.
    const contentRoleRow = insertedRows().find((r) => r.decisionKind === 'content_role')
    expect(contentRoleRow.decisionChoice).toBe('personal')
    expect(contentRoleRow.decisionError).toBeNull()
  })

  it('marks rows chat_judge when nothing is enforced (default)', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(makeEnrichContext())
    await settle!(enrichPrimaries())
    for (const row of insertedRows()) {
      expect(row.authoritativeEngine).toBe('chat_judge')
    }
  })

  it('excludes the generic entity_type question and row when entity_type is enforced', async () => {
    resolveEnforceMock.mockReturnValue(new Set(['entity_type'] as const))
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(allAnswersResponse())
    const settle = startDecisionShadow(makeEnrichContext())
    await settle!(enrichPrimaries())

    const [, req] = runDecisionMock.mock.calls[0]
    expect(Object.keys(req.questions).sort()).toEqual(['category', 'content_role'])
    expect(insertedRows().map((r) => r.decisionKind).sort()).toEqual(['category', 'content_role'])
  })

  it('keeps the entity_type question when enforcement is off (unchanged)', () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startDecisionShadow(makeEnrichContext())
    const [, req] = runDecisionMock.mock.calls[0]
    expect(Object.keys(req.questions).sort()).toEqual(['category', 'content_role', 'entity_type'])
  })
})

describe('runEnforcedPerItemDecisions', () => {
  const ENTITY_CRITERIA = { person: 'A human being', technology: 'A software tool or system' }

  function makeItems(overrides?: PerItemDecisionItem[]): PerItemDecisionItem[] {
    return (
      overrides ?? [
        { ref: 'm1', instructions: 'Type the mention "Alice"', llmChoice: 'person', llmConfidence: 0.7 },
        { ref: 'm2', instructions: 'Type the mention "EigenMesh"', llmChoice: 'technology', llmConfidence: 0.6 },
      ]
    )
  }

  it('runs ONE call with per-item questions and returns both answers with evidence rows', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        'entity_type:m1': { choice: 'person', probabilities: { person: 0.8, technology: 0.2 } },
        'entity_type:m2': { choice: 'technology', probabilities: { technology: 0.9, person: 0.1 } },
      }),
    )
    const answers = await runEnforcedPerItemDecisions({
      userId: 'user-1',
      surface: 'enrich_queued',
      kind: 'entity_type',
      state: 'Alice uses EigenMesh',
      criteria: ENTITY_CRITERIA,
      items: makeItems(),
    })

    expect(runDecisionMock).toHaveBeenCalledTimes(1)
    const [cfg, req] = runDecisionMock.mock.calls[0]
    expect(cfg).toEqual(config)
    expect(req.state).toBe('Alice uses EigenMesh')
    expect(Object.keys(req.questions).sort()).toEqual(['entity_type:m1', 'entity_type:m2'])
    expect(req.questions['entity_type:m1'].instructions).toBe('Type the mention "Alice"')
    expect(req.questions['entity_type:m1'].criteria).toEqual(ENTITY_CRITERIA)

    expect(answers.get('m1')).toEqual({
      choice: 'person',
      probability: 0.8,
      alternatives: { technology: 0.2 },
    })
    expect(answers.get('m2')).toEqual({
      choice: 'technology',
      probability: 0.9,
      alternatives: { person: 0.1 },
    })

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    const byRef = Object.fromEntries(rows.map((r) => [r.subjectRef, r]))
    expect(byRef.m1).toMatchObject({
      userId: 'user-1',
      surface: 'enrich_queued',
      decisionKind: 'entity_type',
      subjectRef: 'm1',
      llmChoice: 'person',
      llmConfidence: 0.7,
      decisionChoice: 'person',
      decisionProbability: 0.8,
      decisionAlternatives: { technology: 0.2 },
      agree: true,
      decisionError: null,
      authoritativeEngine: 'decision_model',
    })
    expect(byRef.m1.decisionDurationMs).toBeTypeOf('number')
    expect(byRef.m2).toMatchObject({
      subjectRef: 'm2',
      llmChoice: 'technology',
      decisionChoice: 'technology',
      agree: true,
    })

    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    const [, userId, call] = logActivityCallMock.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(call.provider).toBe('openrouter')
    expect(call.operation).toBe('decision_shadow')
    expect(call.gatewayHost).toBe('openrouter.ai')
    expect(call.context).toBe('decision_shadow kinds=entity_type items=2 surface=enrich_queued')
    expect(call.baseCostUsd).toBe(0.0000421)
    expect(call.durationMs).toBeTypeOf('number')
  })

  it('records agree null and llmChoice null passthrough when the chat call was skipped', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        'entity_type:m1': { choice: 'person', probabilities: { person: 0.8, technology: 0.2 } },
      }),
    )
    await runEnforcedPerItemDecisions({
      userId: 'user-1',
      surface: 'enrich_queued',
      kind: 'entity_type',
      state: 'x',
      criteria: ENTITY_CRITERIA,
      items: [{ ref: 'm1', instructions: 'i', llmChoice: null }],
    })
    const row = insertedRows()[0]
    expect(row.llmChoice).toBeNull()
    expect(row.llmConfidence).toBeNull()
    expect(row.agree).toBeNull()
  })

  it('writes every item row and throws when one item returns an off-catalog choice', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        'entity_type:m1': { choice: 'person', probabilities: { person: 0.8, technology: 0.2 } },
        'entity_type:m2': { choice: 'animal', probabilities: { animal: 1 } },
      }),
    )
    await expect(
      runEnforcedPerItemDecisions({
        userId: 'user-1',
        surface: 'enrich_queued',
        kind: 'entity_type',
        state: 'x',
        criteria: ENTITY_CRITERIA,
        items: makeItems(),
      }),
    ).rejects.toThrow(/enforced entity_type item m2 returned off-catalog choice "animal"/)

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    const byRef = Object.fromEntries(rows.map((r) => [r.subjectRef, r]))
    // The ok item still gets its answer row.
    expect(byRef.m1).toMatchObject({
      decisionChoice: 'person',
      decisionError: null,
      agree: true,
      authoritativeEngine: 'decision_model',
    })
    // The off-catalog item gets an error row with no answer fields.
    expect(byRef.m2.decisionChoice).toBeNull()
    expect(byRef.m2.decisionProbability).toBeNull()
    expect(byRef.m2.decisionError).toContain('off-catalog')
    expect(byRef.m2.agree).toBeNull()
    // The call happened — its activity row is still recorded.
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
  })

  it('writes error rows for all items and throws when the call fails; activity row still recorded', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    await expect(
      runEnforcedPerItemDecisions({
        userId: 'user-1',
        surface: 'enrich_queued',
        kind: 'entity_type',
        state: 'x',
        criteria: ENTITY_CRITERIA,
        items: makeItems(),
      }),
    ).rejects.toThrow(/enforced entity_type per-item decision failed: 502 bad gateway/)

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.decisionChoice).toBeNull()
      expect(r.decisionError).toBe('502 bad gateway')
      expect(r.agree).toBeNull()
      expect(r.authoritativeEngine).toBe('decision_model')
      expect(r.llmChoice).not.toBeNull()
    }
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
  })

  it('returns an empty Map with no call, no rows, and no activity when items is empty', async () => {
    resolveConfigMock.mockReturnValue(config)
    const answers = await runEnforcedPerItemDecisions({
      userId: 'user-1',
      surface: 'enrich_queued',
      kind: 'entity_type',
      state: 'x',
      criteria: ENTITY_CRITERIA,
      items: [],
    })
    expect(answers.size).toBe(0)
    expect(runDecisionMock).not.toHaveBeenCalled()
    expect(dbMocks.insertValues).not.toHaveBeenCalled()
    expect(logActivityCallMock).not.toHaveBeenCalled()
  })
})

describe('runEnforcedBoundedDecisions', () => {
  const SCOPE_CRITERIA = { memory: 'Personal memory recall', graph: 'Graph traversal over entities' }
  const PROMOTE_CRITERIA = { promote: 'A multi-step initiative the user is running', reject: 'Anything else' }

  function makeSpecs(): BoundedDecisionSpec[] {
    return [
      {
        decisionKind: 'retrieval_scope',
        id: 'scope',
        question: {
          type: 'choice',
          instructions: 'Which retrieval scope should answer this question?',
          criteria: SCOPE_CRITERIA,
        },
        llmChoice: 'memory',
        llmConfidence: 0.66,
      },
      {
        decisionKind: 'gtd_promotion',
        id: 'gtd:hub-0',
        question: {
          type: 'choice',
          instructions: 'Is this hub a GTD project?',
          criteria: PROMOTE_CRITERIA,
        },
        llmChoice: null,
      },
    ]
  }

  it('runs ONE call with questions keyed by spec id and returns the whole-question answers', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        scope: { choice: 'graph', probabilities: { graph: 0.8, memory: 0.2 } },
        'gtd:hub-0': { choice: 'promote', probabilities: { promote: 0.9, reject: 0.1 } },
      }),
    )
    const answers = await runEnforcedBoundedDecisions({
      userId: 'user-1',
      surface: 'qa_intent',
      state: 'What did I decide about the NBN deadline?',
      specs: makeSpecs(),
    })

    expect(runDecisionMock).toHaveBeenCalledTimes(1)
    const [cfg, req] = runDecisionMock.mock.calls[0]
    expect(cfg).toEqual(config)
    expect(req.state).toBe('What did I decide about the NBN deadline?')
    expect(Object.keys(req.questions)).toEqual(['scope', 'gtd:hub-0'])
    expect(req.questions.scope).toEqual(makeSpecs()[0].question)
    expect(req.questions['gtd:hub-0']).toEqual(makeSpecs()[1].question)

    expect(answers.get('scope')).toEqual({
      type: 'choice',
      choice: 'graph',
      probabilities: { graph: 0.8, memory: 0.2 },
      confidence: 0.8,
    })
    expect(answers.get('gtd:hub-0')).toEqual({
      type: 'choice',
      choice: 'promote',
      probabilities: { promote: 0.9, reject: 0.1 },
      confidence: 0.8,
    })

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    const byKind = Object.fromEntries(rows.map((r) => [r.decisionKind, r]))
    expect(byKind.retrieval_scope).toMatchObject({
      userId: 'user-1',
      surface: 'qa_intent',
      decisionKind: 'retrieval_scope',
      subjectRef: null,
      llmChoice: 'memory',
      llmConfidence: 0.66,
      decisionChoice: 'graph',
      decisionProbability: 0.8,
      decisionAlternatives: { memory: 0.2 },
      agree: false,
      decisionError: null,
      authoritativeEngine: 'decision_model',
    })
    expect(byKind.retrieval_scope.decisionDurationMs).toBeTypeOf('number')
    // llmChoice null (chat call skipped) → agree null, never false.
    expect(byKind.gtd_promotion).toMatchObject({
      decisionKind: 'gtd_promotion',
      subjectRef: null,
      llmChoice: null,
      llmConfidence: null,
      decisionChoice: 'promote',
      decisionProbability: 0.9,
      agree: null,
      decisionError: null,
      authoritativeEngine: 'decision_model',
    })

    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    const [, userId, call] = logActivityCallMock.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(call.provider).toBe('openrouter')
    expect(call.operation).toBe('decision_shadow')
    expect(call.gatewayHost).toBe('openrouter.ai')
    expect(call.context).toBe('decision_shadow kinds=retrieval_scope,gtd_promotion surface=qa_intent')
    expect(call.baseCostUsd).toBe(0.0000421)
    expect(call.durationMs).toBeTypeOf('number')
  })

  it('writes ok rows for on-catalog specs, an error row for the off-catalog one, then throws', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        scope: { choice: 'memory', probabilities: { memory: 0.7, graph: 0.3 } },
        'gtd:hub-0': { choice: 'both_somehow', probabilities: { both_somehow: 1 } },
      }),
    )
    await expect(
      runEnforcedBoundedDecisions({
        userId: 'user-1',
        surface: 'gtd_judge',
        state: 'hub context',
        specs: makeSpecs(),
      }),
    ).rejects.toThrow('[decision-plane] enforced gtd_promotion returned off-catalog choice "both_somehow"')

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    const byKind = Object.fromEntries(rows.map((r) => [r.decisionKind, r]))
    // The on-catalog spec still gets its answer row.
    expect(byKind.retrieval_scope).toMatchObject({
      decisionChoice: 'memory',
      decisionError: null,
      agree: true,
      authoritativeEngine: 'decision_model',
    })
    // The off-catalog spec gets an error row with no answer fields.
    expect(byKind.gtd_promotion.decisionChoice).toBeNull()
    expect(byKind.gtd_promotion.decisionProbability).toBeNull()
    expect(byKind.gtd_promotion.decisionAlternatives).toBeNull()
    expect(byKind.gtd_promotion.decisionError).toContain('off-catalog')
    expect(byKind.gtd_promotion.agree).toBeNull()
    // The call happened — its activity row is still recorded.
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
  })

  it('writes error rows for all specs and throws when the call fails; activity row still recorded', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    await expect(
      runEnforcedBoundedDecisions({
        userId: 'user-1',
        surface: 'qa_intent',
        state: 'x',
        specs: makeSpecs(),
      }),
    ).rejects.toThrow(/enforced bounded decision\(s\) failed: 502 bad gateway/)

    const rows = insertedRows()
    expect(rows).toHaveLength(2)
    for (const r of rows) {
      expect(r.decisionChoice).toBeNull()
      expect(r.decisionProbability).toBeNull()
      expect(r.decisionError).toBe('502 bad gateway')
      expect(r.agree).toBeNull()
      expect(r.authoritativeEngine).toBe('decision_model')
    }
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
  })

  it('returns an empty Map with no call, no rows, and no activity when specs is empty', async () => {
    resolveConfigMock.mockReturnValue(config)
    const answers = await runEnforcedBoundedDecisions({
      userId: 'user-1',
      surface: 'qa_intent',
      state: 'x',
      specs: [],
    })
    expect(answers.size).toBe(0)
    expect(runDecisionMock).not.toHaveBeenCalled()
    expect(dbMocks.insertValues).not.toHaveBeenCalled()
    expect(logActivityCallMock).not.toHaveBeenCalled()
  })

  it('throws before any call, row, or activity when the decision-model config is unavailable', async () => {
    resolveConfigMock.mockReturnValue(null)
    await expect(
      runEnforcedBoundedDecisions({
        userId: 'user-1',
        surface: 'qa_intent',
        state: 'x',
        specs: makeSpecs(),
      }),
    ).rejects.toThrow(/DECISION_SHADOW_ENABLED/)
    expect(runDecisionMock).not.toHaveBeenCalled()
    expect(dbMocks.insertValues).not.toHaveBeenCalled()
    expect(logActivityCallMock).not.toHaveBeenCalled()
  })

  it('rejects ambiguous specs — blank or duplicate question ids — before any DB or LLM work', async () => {
    resolveConfigMock.mockReturnValue(config)
    const specs = makeSpecs()
    await expect(
      runEnforcedBoundedDecisions({
        userId: 'user-1',
        surface: 'qa_intent',
        state: 'x',
        specs: [{ ...specs[0], id: '   ' }],
      }),
    ).rejects.toThrow(/bounded question id must not be blank/)
    await expect(
      runEnforcedBoundedDecisions({
        userId: 'user-1',
        surface: 'qa_intent',
        state: 'x',
        specs: [specs[0], { ...specs[1], id: 'scope' }],
      }),
    ).rejects.toThrow(/duplicate bounded question id "scope"/)
    expect(runDecisionMock).not.toHaveBeenCalled()
    expect(dbMocks.insertValues).not.toHaveBeenCalled()
    expect(logActivityCallMock).not.toHaveBeenCalled()
  })
})

describe('surface + kind widening (resolution, delete_gate, chat_turn)', () => {
  it.each(['resolution', 'delete_gate', 'chat_turn'] as const)(
    'records shadow rows verbatim on the new "%s" surface with unchanged behavior',
    async (surface) => {
      resolveConfigMock.mockReturnValue(config)
      runDecisionMock.mockResolvedValue(allAnswersResponse())
      const settle = startDecisionShadow(makeContext({ surface }))
      await settle?.({ category: { choice: 'task', confidence: 0.9 } })

      const row = insertedRows()[0]
      expect(row.surface).toBe(surface)
      expect(row.decisionKind).toBe('category')
      expect(row.decisionChoice).toBe('task')
      expect(row.agree).toBe(true)
      expect(row.authoritativeEngine).toBe('chat_judge')
    },
  )

  it('accepts a widened decision kind on a bounded spec together with a widened surface', async () => {
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockResolvedValue(
      choiceAnswers({
        salience: { choice: 'core', probabilities: { core: 0.9, periphery: 0.1 } },
      }),
    )
    const answers = await runEnforcedBoundedDecisions({
      userId: 'user-1',
      surface: 'chat_turn',
      state: 'x',
      specs: [
        {
          decisionKind: 'salience_band',
          id: 'salience',
          question: {
            type: 'choice',
            instructions: 'Which salience band does this message belong to?',
            criteria: { core: 'Core', periphery: 'Periphery' },
          },
          llmChoice: null,
        },
      ],
    })
    expect(answers.get('salience')?.choice).toBe('core')

    const row = insertedRows()[0]
    expect(row.decisionKind).toBe('salience_band')
    expect(row.surface).toBe('chat_turn')
    expect(row.decisionChoice).toBe('core')
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
  })
})
