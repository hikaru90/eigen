import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyQueryIntent,
  parseQueryIntentResponse,
  QUERY_INTENT_CLASSIFIER_PROMPT,
} from './classify-query-intent'

const { llmChatCompletionMock, resolveEnforceKindsMock, runEnforcedBoundedDecisionsMock } =
  vi.hoisted(() => ({
    llmChatCompletionMock: vi.fn(),
    resolveEnforceKindsMock: vi.fn(),
    runEnforcedBoundedDecisionsMock: vi.fn(),
  }))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))
// Enforcement is controlled through resolveDecisionEnforceKinds (same pattern as
// temporal-graph-sync.spec.ts): under vitest SvelteKit's $env/dynamic/private is
// a transform-time snapshot, so process.env stubs never reach the real resolver.
vi.mock('$lib/server/llm/decision-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-client')>()
  return { ...actual, resolveDecisionEnforceKinds: resolveEnforceKindsMock }
})
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: runEnforcedBoundedDecisionsMock }
})

describe('parseQueryIntentResponse', () => {
  it('parses local temporal ordering intent', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'ordering',
        entityHints: ['Samsung Galaxy S22', 'Dell XPS 13'],
        comparativeOrdering: true,
        personalization: false,
      }),
    )
    expect(intent.scope).toBe('local')
    expect(intent.temporal).toBe(true)
    expect(intent.kind).toBe('ordering')
    expect(intent.entityHints).toEqual(['Samsung Galaxy S22', 'Dell XPS 13'])
    expect(intent.timeWindow).toBeNull()
    expect(intent.durationUnit).toBeNull()
    expect(intent.comparativeOrdering).toBe(true)
  })

  it('parses count and lookback kinds with durationUnit', () => {
    const count = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'count',
        entityHints: ['Run for the Cure'],
        durationUnit: null,
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(count.kind).toBe('count')

    const lookback = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'lookback',
        entityHints: ['Airbnb in San Francisco'],
        durationUnit: 'months',
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(lookback.kind).toBe('lookback')
    expect(lookback.durationUnit).toBe('months')
  })

  it('parses duration intent with time window', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'duration',
        entityHints: ['team meeting', 'workshop'],
        timeWindowStart: '2023-01-01T00:00:00.000Z',
        timeWindowEnd: '2023-02-01T00:00:00.000Z',
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(intent.kind).toBe('duration')
    expect(intent.timeWindow?.start.toISOString()).toBe('2023-01-01T00:00:00.000Z')
    expect(intent.timeWindow?.end.toISOString()).toBe('2023-02-01T00:00:00.000Z')
  })

  it('parses personalization true and false', () => {
    const base = {
      scope: 'local',
      temporal: false,
      kind: 'none',
      entityHints: [],
      comparativeOrdering: false,
    }
    expect(
      parseQueryIntentResponse(JSON.stringify({ ...base, personalization: true })).personalization,
    ).toBe(true)
    expect(
      parseQueryIntentResponse(JSON.stringify({ ...base, personalization: false })).personalization,
    ).toBe(false)
  })

  it('fails loud when personalization is missing or not a boolean', () => {
    const base = {
      scope: 'local',
      temporal: false,
      kind: 'none',
      entityHints: [],
      comparativeOrdering: false,
    }
    expect(() => parseQueryIntentResponse(JSON.stringify(base))).toThrow(
      /personalization must be a boolean/,
    )
    for (const bad of ['true', 1, null]) {
      expect(() =>
        parseQueryIntentResponse(JSON.stringify({ ...base, personalization: bad })),
      ).toThrow(/personalization must be a boolean/)
    }
  })

  it('the classifier prompt defines personalization and asks for it in the JSON shape', () => {
    expect(QUERY_INTENT_CLASSIFIER_PROMPT).toContain('"personalization":boolean')
    expect(QUERY_INTENT_CLASSIFIER_PROMPT).toContain('personalization true')
    expect(QUERY_INTENT_CLASSIFIER_PROMPT).toContain('personalization false')
  })

  it('rejects invalid scope', () => {
    expect(() =>
      parseQueryIntentResponse(
        JSON.stringify({ scope: 'hybrid', temporal: false, kind: 'none', entityHints: [] }),
      ),
    ).toThrow(/scope must be/)
  })

  it('treats invalid or placeholder time window bounds as omitted', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'ordering',
        entityHints: ['event A', 'event B'],
        timeWindowStart: 'omit',
        timeWindowEnd: 'unknown',
        comparativeOrdering: true,
        personalization: false,
      }),
    )
    expect(intent.timeWindow).toBeNull()
  })

  it('ignores a lone valid window bound without the pair', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'absolute',
        entityHints: [],
        timeWindowStart: '2023-06-01T00:00:00.000Z',
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(intent.timeWindow).toBeNull()
  })

  it('preserves German entityHints verbatim from classifier output', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'ordering',
        entityHints: ['Fahrrad', 'Auto'],
        durationUnit: null,
        comparativeOrdering: true,
        personalization: false,
      }),
    )
    expect(intent.entityHints).toEqual(['Fahrrad', 'Auto'])
    expect(intent.comparativeOrdering).toBe(true)
  })

  it('parses Walk for Hunger / Coastal Cleanup duration intent', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'duration',
        entityHints: ['Walk for Hunger', 'Coastal Cleanup'],
        durationUnit: 'days',
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(intent.kind).toBe('duration')
    expect(intent.entityHints).toEqual(['Walk for Hunger', 'Coastal Cleanup'])
    expect(intent.durationUnit).toBe('days')
  })

  it('parses NovaTech span intent (not lookback)', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'span',
        entityHints: ['working professionally', 'NovaTech'],
        durationUnit: null,
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(intent.kind).toBe('span')
    expect(intent.entityHints).toContain('NovaTech')
  })

  it('parses book ordering intent with comparativeOrdering true', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'ordering',
        entityHints: ['The Hate U Give', 'The Nightingale'],
        durationUnit: null,
        comparativeOrdering: true,
        personalization: false,
      }),
    )
    expect(intent.kind).toBe('ordering')
    expect(intent.comparativeOrdering).toBe(true)
  })

  it('parses Rachel house duration with semantic entityHints', () => {
    const intent = parseQueryIntentResponse(
      JSON.stringify({
        scope: 'local',
        temporal: true,
        kind: 'duration',
        entityHints: ['starting to work with Rachel', 'find a house I loved'],
        durationUnit: 'days',
        comparativeOrdering: false,
        personalization: false,
      }),
    )
    expect(intent.kind).toBe('duration')
    expect(intent.entityHints).toEqual(['starting to work with Rachel', 'find a house I loved'])
  })
})

const QUERY = 'How many months ago did I book the Airbnb in San Francisco?'

const QWEN_CONTENT = JSON.stringify({
  scope: 'global',
  temporal: true,
  kind: 'lookback',
  entityHints: ['Airbnb in San Francisco'],
  durationUnit: 'months',
  comparativeOrdering: false,
  personalization: false,
  timeWindowStart: '2026-01-05T00:00:00.000Z',
  timeWindowEnd: '2026-03-05T00:00:00.000Z',
})

function decisionAnswer(choice: string, probabilities: Record<string, number>) {
  return { type: 'choice' as const, choice, probabilities, confidence: 0.9 }
}

describe('classifyQueryIntent Jev enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    llmChatCompletionMock.mockResolvedValue({
      choices: [{ message: { content: QWEN_CONTENT } }],
    })
    resolveEnforceKindsMock.mockReturnValue(new Set())
    runEnforcedBoundedDecisionsMock.mockResolvedValue(new Map())
  })

  it('overrides scope, kind, and durationUnit from ONE enforced bounded call; qwen fields stay', async () => {
    resolveEnforceKindsMock.mockReturnValue(
      new Set(['retrieval_scope', 'query_temporal_kind', 'duration_unit']),
    )
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      new Map([
        ['scope', decisionAnswer('local', { local: 0.8, global: 0.2 })],
        ['temporal_kind', decisionAnswer('count', { count: 0.7, lookback: 0.3 })],
        ['duration_unit', decisionAnswer('none', { none: 0.9 })],
      ]),
    )

    const intent = await classifyQueryIntent({ userId: 'u1', query: QUERY })

    // Bounded fields overridden by Jev.
    expect(intent.scope).toBe('local')
    expect(intent.kind).toBe('count')
    expect(intent.durationUnit).toBeNull()
    // Everything else stays from the qwen parse.
    expect(intent.temporal).toBe(true)
    expect(intent.entityHints).toEqual(['Airbnb in San Francisco'])
    expect(intent.timeWindow?.start.toISOString()).toBe('2026-01-05T00:00:00.000Z')
    expect(intent.timeWindow?.end.toISOString()).toBe('2026-03-05T00:00:00.000Z')
    expect(intent.comparativeOrdering).toBe(false)

    expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    const call = runEnforcedBoundedDecisionsMock.mock.calls[0][0] as {
      userId: string
      surface: string
      state: string
      specs: Array<{
        decisionKind: string
        id: string
        question: { type: string; instructions: string; criteria: Record<string, string> }
        llmChoice: string | null
        llmConfidence: number | null
      }>
    }
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('qa_intent')
    expect(call.state).toBe(QUERY)
    expect(call.specs).toHaveLength(3)

    const [scopeSpec, kindSpec, unitSpec] = call.specs
    expect(scopeSpec.decisionKind).toBe('retrieval_scope')
    expect(scopeSpec.id).toBe('scope')
    expect(scopeSpec.question.type).toBe('choice')
    expect(scopeSpec.question.criteria.global).toContain('whole stored memory')
    expect(scopeSpec.question.criteria.local).toContain('immediate conversation context')
    expect(scopeSpec.llmChoice).toBe('global')
    expect(scopeSpec.llmConfidence).toBeNull()

    expect(kindSpec.decisionKind).toBe('query_temporal_kind')
    expect(kindSpec.id).toBe('temporal_kind')
    expect(kindSpec.question.criteria).toHaveProperty('multi_ordering')
    expect(kindSpec.question.criteria.none).toContain('No temporal reasoning')
    expect(kindSpec.llmChoice).toBe('lookback')
    expect(kindSpec.llmConfidence).toBeNull()

    expect(unitSpec.decisionKind).toBe('duration_unit')
    expect(unitSpec.id).toBe('duration_unit')
    expect(unitSpec.question.criteria).toHaveProperty('none')
    expect(unitSpec.llmChoice).toBe('months')
    expect(unitSpec.llmConfidence).toBeNull()
  })

  it('maps the duration_unit "none" answer back to null and keeps other units', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['duration_unit']))
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      new Map([
        ['scope', decisionAnswer('global', { global: 0.6, local: 0.4 })],
        ['temporal_kind', decisionAnswer('lookback', { lookback: 0.8 })],
        ['duration_unit', decisionAnswer('weeks', { weeks: 0.9, months: 0.1 })],
      ]),
    )

    const intent = await classifyQueryIntent({ userId: 'u1', query: QUERY })

    expect(intent.durationUnit).toBe('weeks')
    expect(intent.scope).toBe('global')
    expect(intent.kind).toBe('lookback')
    const call = runEnforcedBoundedDecisionsMock.mock.calls[0][0] as {
      specs: Array<{ id: string; llmChoice: string | null }>
    }
    // Passthrough is the raw qwen parse, before the override.
    expect(call.specs.map((s) => s.llmChoice)).toEqual(['global', 'lookback', 'months'])
  })

  it('propagates an enforced decision failure (no fallback, no try/catch)', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set(['retrieval_scope']))
    runEnforcedBoundedDecisionsMock.mockRejectedValue(
      new Error('[decision-plane] enforced bounded decision(s) failed: gateway down'),
    )

    await expect(classifyQueryIntent({ userId: 'u1', query: QUERY })).rejects.toThrow(
      'gateway down',
    )
  })

  it('makes no decision-plane call and keeps the qwen parse when enforcement is off', async () => {
    resolveEnforceKindsMock.mockReturnValue(new Set())

    const intent = await classifyQueryIntent({ userId: 'u1', query: QUERY })

    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
    expect(intent).toEqual({
      scope: 'global',
      temporal: true,
      kind: 'lookback',
      entityHints: ['Airbnb in San Francisco'],
      timeWindow: {
        start: new Date('2026-01-05T00:00:00.000Z'),
        end: new Date('2026-03-05T00:00:00.000Z'),
      },
      durationUnit: 'months',
      comparativeOrdering: false,
      personalization: false,
    })
  })
})
