import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getDbMock,
  llmChatCompletionMock,
  loadOntologyForUserMock,
  resolveShadowConfigMock,
  resolveEnforceKindsMock,
  runDecisionModelMock,
  logActivityCallMock,
} = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
  loadOntologyForUserMock: vi.fn(),
  resolveShadowConfigMock: vi.fn(),
  resolveEnforceKindsMock: vi.fn(),
  runDecisionModelMock: vi.fn(),
  logActivityCallMock: vi.fn(),
}))

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }))
vi.mock('$lib/server/llm/llm-client', () => ({ llmChatCompletion: llmChatCompletionMock }))
vi.mock('$lib/server/observability/graph-scale-quiet', () => ({ isGraphScaleQuiet: () => true }))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: logActivityCallMock }))
// The real validateEntityKindKeyForNewIngest stays live — it validates against the
// loaded ontology fixture, so the off-catalog contract is exercised for real.
vi.mock('$lib/server/ontology-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/ontology-db')>()
  return { ...actual, loadOntologyForUser: loadOntologyForUserMock }
})
// decision-plane stays REAL — only its OpenRouter client is mocked, so these
// tests exercise the actual enforcement/settle contract (same convention as
// enrich-queued-thought.spec.ts).
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return {
    ...actual,
    resolveDecisionShadowConfig: resolveShadowConfigMock,
    resolveDecisionEnforceKinds: resolveEnforceKindsMock,
    runDecisionModel: runDecisionModelMock,
  }
})

import { resolveThoughtCategory } from './classify-thought-category'

const DECISION_ENV_KEYS = [
  'DECISION_ENFORCE_KINDS',
  'DECISION_SHADOW_ENABLED',
  'OPENROUTER_API_KEY',
  'DECISION_SHADOW_MODEL',
] as const

let savedEnv: Record<string, string | undefined> = {}

function setDecisionEnv(input: { enforce: string | null }): void {
  process.env.DECISION_SHADOW_ENABLED = 'true'
  process.env.OPENROUTER_API_KEY = 'test-key'
  process.env.DECISION_SHADOW_MODEL = 'typesafe/jev-1.13'
  if (input.enforce === null) delete process.env.DECISION_ENFORCE_KINDS
  else process.env.DECISION_ENFORCE_KINDS = input.enforce
}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = Object.fromEntries(DECISION_ENV_KEYS.map((k) => [k, process.env[k]]))
  logActivityCallMock.mockResolvedValue(undefined)
})

afterEach(() => {
  for (const k of DECISION_ENV_KEYS) {
    const v = savedEnv[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

function loadedOntology() {
  const kinds = [
    {
      id: 'ek-task',
      userId: 'u1',
      key: 'task',
      name: 'Task',
      definition: 'A task to do.',
      active: true,
      kindType: 'thought_category',
      neverStale: false,
    },
    {
      id: 'ek-idea',
      userId: 'u1',
      key: 'idea',
      name: 'Idea',
      definition: 'An idea.',
      active: true,
      kindType: 'thought_category',
      neverStale: false,
    },
    {
      id: 'ek-observation',
      userId: 'u1',
      key: 'observation',
      name: 'Observation',
      definition: 'An observation.',
      active: true,
      kindType: 'thought_category',
      neverStale: false,
    },
  ]
  return {
    entityKinds: kinds,
    relationKinds: [],
    entityKindsById: new Map(kinds.map((k) => [k.id, k])),
    entityKindsByKey: new Map(kinds.map((k) => [k.key, k])),
    relationKindsById: new Map(),
    relationKindsByKey: new Map(),
  }
}

/** Chainable select-step: profile row, recent thoughts, and category distribution reads. */
function makeDb(selectResults: unknown[][]) {
  let i = 0
  const select = vi.fn(() => {
    const rows = selectResults[i] ?? []
    i += 1
    return {
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
          orderBy: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      }),
    }
  })
  const insertValues = vi.fn(async () => [])
  const insert = vi.fn(() => ({ values: insertValues }))
  return { select, insert, insertValues }
}

function chatResponse(payload: unknown) {
  return { choices: [{ message: { content: JSON.stringify(payload) } }] }
}

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

function emptyDb(): void {
  getDbMock.mockReturnValue(makeDb([[], [], []]))
}

describe('resolveThoughtCategory', () => {
  it('enforced category: the decision-model answer overrides the chat judge', async () => {
    setDecisionEnv({ enforce: 'category' })
    resolveEnforceKindsMock.mockReturnValue(new Set(['category']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockResolvedValue(
      decisionResponse({
        category: { choice: 'observation', probabilities: { observation: 0.62, task: 0.3, idea: 0.08 } },
      }),
    )
    // The chat judge answers differently — under enforcement it is only the
    // recorded comparison, never the persisted decision.
    llmChatCompletionMock.mockResolvedValue(chatResponse({ category: 'task', confidence: 0.9 }))
    loadOntologyForUserMock.mockResolvedValue(loadedOntology())
    const db = makeDb([[], [], []])
    getDbMock.mockReturnValue(db)

    const resolved = await resolveThoughtCategory({
      userId: 'u1',
      normalized: 'some captured text',
      rawText: 'some captured text',
    })

    expect(resolved).toEqual({
      key: 'observation',
      ontologyEntityKindId: 'ek-observation',
      confidence: 0.62,
      alternatives: [
        { key: 'idea', confidence: 0.08 },
        { key: 'task', confidence: 0.3 },
      ],
      source: 'decision_model',
    })
    // Roles reversed (spec P5): the chat judge's answer is the comparison
    // column, the decision model's answer is the authoritative one.
    const rows = db.insertValues.mock.calls[0]?.[0] as Array<Record<string, unknown>>
    expect(rows[0]).toMatchObject({
      llmChoice: 'task',
      decisionChoice: 'observation',
      authoritativeEngine: 'decision_model',
    })
  })

  it('enforced category: an off-catalog decision-model key fails loudly', async () => {
    setDecisionEnv({ enforce: 'category' })
    resolveEnforceKindsMock.mockReturnValue(new Set(['category']))
    resolveShadowConfigMock.mockReturnValue({ apiKey: 'k', model: 'm' })
    runDecisionModelMock.mockResolvedValue(
      decisionResponse({ category: { choice: 'made_up_key', probabilities: { made_up_key: 1 } } }),
    )
    llmChatCompletionMock.mockResolvedValue(chatResponse({ category: 'task', confidence: 0.9 }))
    loadOntologyForUserMock.mockResolvedValue(loadedOntology())
    emptyDb()

    await expect(
      resolveThoughtCategory({ userId: 'u1', normalized: 'some captured text', rawText: 'some captured text' }),
    ).rejects.toThrow('Category decision returned invalid ontology key: made_up_key')
  })

  it('without enforcement: the chat judge answer stays authoritative with source llm', async () => {
    setDecisionEnv({ enforce: null })
    resolveEnforceKindsMock.mockReturnValue(new Set())
    resolveShadowConfigMock.mockReturnValue(null)
    llmChatCompletionMock.mockResolvedValue(
      chatResponse({
        category: 'idea',
        confidence: 0.9,
        alternatives: [{ key: 'task', confidence: 0.1 }],
      }),
    )
    loadOntologyForUserMock.mockResolvedValue(loadedOntology())
    emptyDb()

    const resolved = await resolveThoughtCategory({
      userId: 'u1',
      normalized: 'some captured text',
      rawText: 'some captured text',
    })

    expect(resolved).toEqual({
      key: 'idea',
      ontologyEntityKindId: 'ek-idea',
      confidence: 0.9,
      alternatives: [{ key: 'task', confidence: 0.1 }],
      source: 'llm',
    })
    expect(runDecisionModelMock).not.toHaveBeenCalled()
  })
})
