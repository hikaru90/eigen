import type { DecisionShadowConfig } from './decision-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dominantEntityType,
  startContentRoleDecision,
  startDecisionShadow,
  type DecisionShadowContext,
  type DecisionShadowPrimaries,
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
    contentRole: { choice: 'thought_only' },
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
    content_role: { choice: 'thought_only', probabilities: { thought_only: 0.8, split: 0.2 } },
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
    expect(req.questions.content_role.criteria).toEqual({
      thought_only: expect.stringMatching(/self-contained/),
      split: expect.stringMatching(/linked note/),
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
      llmChoice: 'thought_only',
      llmConfidence: null,
      decisionChoice: 'thought_only',
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
    expect(rows.find((r) => r.decisionKind === 'content_role')?.llmChoice).toBe('thought_only')
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

describe('enforcement — startContentRoleDecision (early, pre-split call)', () => {
  const ENFORCED = new Set(['category', 'content_role'] as const)

  it('returns null when content_role is not enforced (today\u2019s shadow-only flow)', () => {
    resolveEnforceMock.mockReturnValue(new Set(['category'] as const))
    expect(startContentRoleDecision({ userId: 'user-1', state: 'text' })).toBeNull()
  })

  it('throws when enforced but the decision-model config is disabled', () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(null)
    expect(() => startContentRoleDecision({ userId: 'user-1', state: 'text' })).toThrow(
      /content_role/,
    )
  })

  it('asks ONLY the content_role question and kicks the call immediately', () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockReturnValue(new Promise(() => {}))
    startContentRoleDecision({ userId: 'user-1', state: 'recipe text' })
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
        content_role: { choice: 'split', probabilities: { split: 0.9, thought_only: 0.1 } },
      }),
    )
    const handle = startContentRoleDecision({ userId: 'user-1', state: 'recipe text' })
    const decided = await handle!.decide()
    expect(decided.mode).toBe('split')
    expect(decided.probability).toBe(0.9)
    expect(decided.alternatives).toEqual({ thought_only: 0.1 })
    expect(decided.durationMs).toBeTypeOf('number')
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
    const handle = startContentRoleDecision({ userId: 'user-1', state: 'text' })
    await expect(handle!.decide()).rejects.toThrow(/off-catalog choice "both_somehow"/)
  })

  it('decide() throws when the call fails (into the ingest retry ladder)', async () => {
    resolveEnforceMock.mockReturnValue(ENFORCED)
    resolveConfigMock.mockReturnValue(config)
    runDecisionMock.mockRejectedValue(new Error('502 bad gateway'))
    const handle = startContentRoleDecision({ userId: 'user-1', state: 'text' })
    await expect(handle!.decide()).rejects.toThrow(/enforced content_role decision failed.*502/s)
  })
})

describe('enforcement — startDecisionShadow settle contract', () => {
  const ENFORCED = new Set(['category', 'content_role'] as const)

  function contentRoleContext(): DecisionShadowContext {
    return makeEnrichContext({
      enforcedContentRole: {
        mode: 'thought_only',
        probability: 0.8,
        alternatives: { split: 0.2 },
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
      llmChoice: 'thought_only',
      decisionChoice: 'thought_only',
      decisionProbability: 0.8,
      decisionAlternatives: { split: 0.2 },
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
      decisionChoice: 'thought_only',
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
    expect(contentRoleRow.decisionChoice).toBe('thought_only')
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
})
