import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  classifyQueryIntent,
  parseQueryExtractionResponse,
  QUERY_EXTRACTION_PROMPT,
} from './classify-query-intent'

const { llmChatCompletionMock, runEnforcedBoundedDecisionsMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
  runEnforcedBoundedDecisionsMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))
// The decision plane is mocked at its boundary: query intent runs on Jev unconditionally (no
// enforcement switch, no chat fallback), so no spec may reach the real Decisions API.
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedBoundedDecisions: runEnforcedBoundedDecisionsMock }
})

describe('parseQueryExtractionResponse (the chat model only extracts entity hints and a time window)', () => {
  it('parses entity hints verbatim and no time window', () => {
    const out = parseQueryExtractionResponse(
      JSON.stringify({ entityHints: ['Samsung Galaxy S22', 'Dell XPS 13'] }),
    )
    expect(out.entityHints).toEqual(['Samsung Galaxy S22', 'Dell XPS 13'])
    expect(out.timeWindow).toBeNull()
  })

  it('parses a time window pair and orders its bounds', () => {
    const out = parseQueryExtractionResponse(
      JSON.stringify({
        entityHints: ['team meeting', 'workshop'],
        timeWindowStart: '2023-02-01T00:00:00.000Z',
        timeWindowEnd: '2023-01-01T00:00:00.000Z',
      }),
    )
    expect(out.timeWindow?.start.toISOString()).toBe('2023-01-01T00:00:00.000Z')
    expect(out.timeWindow?.end.toISOString()).toBe('2023-02-01T00:00:00.000Z')
  })

  it('treats invalid or placeholder time window bounds as omitted, and a lone bound too', () => {
    expect(
      parseQueryExtractionResponse(
        JSON.stringify({ entityHints: [], timeWindowStart: 'omit', timeWindowEnd: 'unknown' }),
      ).timeWindow,
    ).toBeNull()
    expect(
      parseQueryExtractionResponse(
        JSON.stringify({ entityHints: [], timeWindowStart: '2023-06-01T00:00:00.000Z' }),
      ).timeWindow,
    ).toBeNull()
  })

  it('preserves German entity hints verbatim and drops blanks', () => {
    expect(
      parseQueryExtractionResponse(JSON.stringify({ entityHints: ['Fahrrad', '  Auto ', '', 7] }))
        .entityHints,
    ).toEqual(['Fahrrad', 'Auto'])
  })

  it('fails loud when entityHints is missing or not an array, or the reply is not an object', () => {
    expect(() => parseQueryExtractionResponse(JSON.stringify({}))).toThrow(
      /entityHints must be an array/,
    )
    expect(() => parseQueryExtractionResponse(JSON.stringify({ entityHints: 'Fahrrad' }))).toThrow(
      /entityHints must be an array/,
    )
    expect(() => parseQueryExtractionResponse('"text"')).toThrow(/not a JSON object/)
  })

  it('does not read any decision from the chat reply: scope, kind, unit and the booleans belong to Jev', () => {
    const out = parseQueryExtractionResponse(
      JSON.stringify({
        scope: 'global',
        temporal: true,
        kind: 'ordering',
        durationUnit: 'days',
        comparativeOrdering: true,
        personalization: true,
        entityHints: ['A', 'B'],
      }),
    )
    expect(Object.keys(out).sort()).toEqual(['entityHints', 'timeWindow'])
  })
})

describe('QUERY_EXTRACTION_PROMPT', () => {
  it('asks only for entity hints and the time window — no scope, kind, unit, temporal, ordering or personalization', () => {
    expect(QUERY_EXTRACTION_PROMPT).toContain('entityHints')
    expect(QUERY_EXTRACTION_PROMPT).toContain('timeWindowStart')
    expect(QUERY_EXTRACTION_PROMPT).toContain('timeWindowEnd')
    for (const decision of [
      '"scope"',
      '"kind"',
      '"durationUnit"',
      '"temporal"',
      'comparativeOrdering',
      'personalization',
    ]) {
      expect(QUERY_EXTRACTION_PROMPT).not.toContain(decision)
    }
  })

  it('keeps the rules for copying hints verbatim in the question language and including every endpoint', () => {
    expect(QUERY_EXTRACTION_PROMPT).toMatch(/verbatim/i)
    expect(QUERY_EXTRACTION_PROMPT).toMatch(/any language/i)
    expect(QUERY_EXTRACTION_PROMPT).toMatch(/every endpoint|all endpoints/i)
    expect(QUERY_EXTRACTION_PROMPT).toMatch(/never use placeholder text/i)
  })
})

const QUERY = 'How many months ago did I book the Airbnb in San Francisco?'

const EXTRACTION_CONTENT = JSON.stringify({
  entityHints: ['Airbnb in San Francisco'],
  timeWindowStart: '2026-01-05T00:00:00.000Z',
  timeWindowEnd: '2026-03-05T00:00:00.000Z',
})

function answer(choice: string, probabilities: Record<string, number>) {
  return { type: 'choice' as const, choice, probabilities, confidence: 0.9 }
}

function jevAnswers(over: Record<string, ReturnType<typeof answer>> = {}) {
  return new Map<string, ReturnType<typeof answer>>(
    Object.entries({
      scope: answer('local', { local: 0.8, global: 0.2 }),
      temporal_kind: answer('lookback', { lookback: 0.7, absolute: 0.3 }),
      duration_unit: answer('months', { months: 0.9, weeks: 0.1 }),
      temporal: answer('yes', { yes: 0.95, no: 0.05 }),
      comparative_ordering: answer('no', { no: 0.9, yes: 0.1 }),
      personalization: answer('no', { no: 0.85, yes: 0.15 }),
      ...over,
    }),
  )
}

type Spec = {
  decisionKind: string
  id: string
  question: { type: string; instructions: string; criteria: Record<string, string> }
  llmChoice: string | null
  llmConfidence?: number | null
}

describe('classifyQueryIntent: every decision is Jev, the chat model only extracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: EXTRACTION_CONTENT } }] })
    runEnforcedBoundedDecisionsMock.mockResolvedValue(jevAnswers())
  })

  it('asks Jev ONE call with six questions on the qa_intent surface, the question as state, no chat comparison', async () => {
    await classifyQueryIntent({ userId: 'u1', query: QUERY })

    expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    const call = runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as {
      userId: string
      surface: string
      state: string
      specs: Spec[]
    }
    expect(call.userId).toBe('u1')
    expect(call.surface).toBe('qa_intent')
    expect(call.state).toBe(QUERY)
    expect(call.specs.map((s) => [s.decisionKind, s.id])).toEqual([
      ['retrieval_scope', 'scope'],
      ['query_temporal_kind', 'temporal_kind'],
      ['duration_unit', 'duration_unit'],
      ['query_temporal', 'temporal'],
      ['comparative_ordering', 'comparative_ordering'],
      ['query_personalization', 'personalization'],
    ])
    for (const spec of call.specs) {
      expect(spec.question.type).toBe('choice')
      // the chat model decides nothing any more: there is no answer to compare against
      expect(spec.llmChoice).toBeNull()
      expect(Object.keys(spec.question.criteria).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('the three existing questions keep their criteria', async () => {
    await classifyQueryIntent({ userId: 'u1', query: QUERY })
    const specs = (runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as { specs: Spec[] }).specs
    const [scope, kind, unit] = specs
    expect(scope!.question.criteria.global).toContain('whole stored memory')
    expect(scope!.question.criteria.local).toContain('immediate conversation context')
    expect(kind!.question.criteria).toHaveProperty('multi_ordering')
    expect(kind!.question.criteria.none).toContain('No temporal reasoning')
    expect(unit!.question.criteria).toHaveProperty('none')
  })

  it('query_temporal is a yes/no question about dates and the order of events', async () => {
    await classifyQueryIntent({ userId: 'u1', query: QUERY })
    const spec = (runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as { specs: Spec[] }).specs.find(
      (s) => s.id === 'temporal',
    )!
    expect(Object.keys(spec.question.criteria)).toEqual(['yes', 'no'])
    expect(spec.question.instructions).toMatch(/dates|order of events/i)
    expect(spec.question.criteria.yes).toMatch(/comparing dates/i)
    expect(spec.question.criteria.yes).toMatch(/relative to another event/i)
    expect(spec.question.criteria.no).toMatch(/no timeline comparison or date arithmetic/i)
  })

  it('comparative_ordering is a yes/no question: which of several named alternatives came first, not a fact after an anchor', async () => {
    await classifyQueryIntent({ userId: 'u1', query: QUERY })
    const spec = (runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as { specs: Spec[] }).specs.find(
      (s) => s.id === 'comparative_ordering',
    )!
    expect(Object.keys(spec.question.criteria)).toEqual(['yes', 'no'])
    expect(spec.question.criteria.yes).toMatch(/two or more named alternatives/i)
    expect(spec.question.criteria.yes).toContain('Fahrrad oder Auto')
    expect(spec.question.criteria.no).toMatch(/first issue after/i)
  })

  it('query_personalization is a yes/no question: does a good answer depend on who the user is', async () => {
    await classifyQueryIntent({ userId: 'u1', query: QUERY })
    const spec = (runEnforcedBoundedDecisionsMock.mock.calls[0]![0] as { specs: Spec[] }).specs.find(
      (s) => s.id === 'personalization',
    )!
    expect(Object.keys(spec.question.criteria)).toEqual(['yes', 'no'])
    expect(spec.question.criteria.yes).toMatch(/preferences, health, habits, constraints/i)
    expect(spec.question.criteria.yes).toMatch(/advice, recommendations/i)
    expect(spec.question.criteria.no).toMatch(/fact lookup/i)
    expect(spec.question.criteria.no).toMatch(/third party/i)
  })

  it('the answer comes from Jev: scope, kind, unit and the three booleans; hints and window from the chat extraction', async () => {
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      jevAnswers({
        scope: answer('global', { global: 0.7, local: 0.3 }),
        temporal_kind: answer('count', { count: 0.7, lookback: 0.3 }),
        duration_unit: answer('none', { none: 0.9, months: 0.1 }),
        temporal: answer('no', { no: 0.8, yes: 0.2 }),
        comparative_ordering: answer('yes', { yes: 0.9, no: 0.1 }),
        personalization: answer('yes', { yes: 0.9, no: 0.1 }),
      }),
    )

    const intent = await classifyQueryIntent({ userId: 'u1', query: QUERY })

    expect(intent).toEqual({
      scope: 'global',
      temporal: false,
      kind: 'count',
      entityHints: ['Airbnb in San Francisco'],
      timeWindow: {
        start: new Date('2026-01-05T00:00:00.000Z'),
        end: new Date('2026-03-05T00:00:00.000Z'),
      },
      durationUnit: null,
      comparativeOrdering: true,
      personalization: true,
    })
  })

  it('keeps a concrete duration unit and the yes answers', async () => {
    const intent = await classifyQueryIntent({ userId: 'u1', query: QUERY })
    expect(intent.durationUnit).toBe('months')
    expect(intent.temporal).toBe(true)
    expect(intent.comparativeOrdering).toBe(false)
    expect(intent.personalization).toBe(false)
  })

  it('the chat reply decides nothing: a reply that still carries old decision keys changes nothing', async () => {
    llmChatCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              scope: 'global',
              temporal: false,
              kind: 'ordering',
              durationUnit: 'days',
              comparativeOrdering: true,
              personalization: true,
              entityHints: ['x'],
            }),
          },
        },
      ],
    })
    const intent = await classifyQueryIntent({ userId: 'u1', query: QUERY })
    expect(intent.scope).toBe('local')
    expect(intent.kind).toBe('lookback')
    expect(intent.durationUnit).toBe('months')
    expect(intent.temporal).toBe(true)
    expect(intent.comparativeOrdering).toBe(false)
    expect(intent.personalization).toBe(false)
  })

  it('asks the chat model once, in json mode, with the extraction prompt and the question', async () => {
    await classifyQueryIntent({ userId: 'u1', query: `  ${QUERY}  ` })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const call = llmChatCompletionMock.mock.calls[0]![0]
    expect(call.responseFormat).toBe('json_object')
    expect(call.temperature).toBe(0)
    expect(call.logContext).toBe('query_intent_classifier')
    expect(call.messages).toEqual([
      { role: 'system', content: QUERY_EXTRACTION_PROMPT },
      { role: 'user', content: QUERY },
    ])
  })

  it('starts the chat extraction and the Jev call together (neither waits for the other)', async () => {
    let releaseChat: (value: unknown) => void = () => {}
    llmChatCompletionMock.mockReturnValue(
      new Promise((resolve) => {
        releaseChat = resolve
      }),
    )
    const pending = classifyQueryIntent({ userId: 'u1', query: QUERY })
    await Promise.resolve()
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(runEnforcedBoundedDecisionsMock).toHaveBeenCalledTimes(1)
    releaseChat({ choices: [{ message: { content: EXTRACTION_CONTENT } }] })
    await expect(pending).resolves.toMatchObject({ entityHints: ['Airbnb in San Francisco'] })
  })

  it('propagates a Jev failure (no fallback to anything the chat model says)', async () => {
    runEnforcedBoundedDecisionsMock.mockRejectedValue(
      new Error('[decision-plane] enforced bounded decision(s) failed: gateway down'),
    )
    await expect(classifyQueryIntent({ userId: 'u1', query: QUERY })).rejects.toThrow('gateway down')
  })

  it('propagates a chat extraction failure and rejects an empty reply', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [{ message: { content: '  ' } }] })
    await expect(classifyQueryIntent({ userId: 'u1', query: QUERY })).rejects.toThrow(
      /empty LLM response/,
    )
    llmChatCompletionMock.mockRejectedValue(new Error('chat down'))
    await expect(classifyQueryIntent({ userId: 'u1', query: QUERY })).rejects.toThrow('chat down')
  })

  it('fails loud when Jev returns no answer for a question, or a choice outside yes/no for a boolean', async () => {
    const missing = jevAnswers()
    missing.delete('personalization')
    runEnforcedBoundedDecisionsMock.mockResolvedValue(missing)
    await expect(classifyQueryIntent({ userId: 'u1', query: QUERY })).rejects.toThrow(
      /enforced decision "personalization" returned no answer/,
    )
    runEnforcedBoundedDecisionsMock.mockResolvedValue(
      jevAnswers({ temporal: answer('maybe', { maybe: 1 }) }),
    )
    await expect(classifyQueryIntent({ userId: 'u1', query: QUERY })).rejects.toThrow(
      /"temporal" answered "maybe"/,
    )
  })

  it('rejects an empty question before any call', async () => {
    await expect(classifyQueryIntent({ userId: 'u1', query: '   ' })).rejects.toThrow(
      /query must be non-empty/,
    )
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(runEnforcedBoundedDecisionsMock).not.toHaveBeenCalled()
  })
})
