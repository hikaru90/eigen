import type { EnrichmentContext } from './enrichment-context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runIngestWithRetries } from '$lib/server/ingest/retry'
import { ASK_QUESTION_RULE } from '$lib/server/memory/ask-question'
import { TEMPORAL_ELEMENT_CONTRACT } from '$lib/server/memory/temporal-normalize'
import type { LoadedUserOntology } from '$lib/server/ontology-db/load-ontology'
import { enrichThoughtBundleInternals, extractEnrichThoughtBundle } from './enrich-thought-bundle'
import { CAPTURE_PRIMARY_HEADING } from './enrichment-prompt-sections'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

function makeOntology(): LoadedUserOntology {
  const kinds = [
    {
      id: 'ek-obs',
      key: 'observation',
      name: 'Observation',
      definition: 'Something noticed',
      kindType: 'thought_category' as const,
      active: true,
      neverStale: false,
    },
    {
      id: 'ek-task',
      key: 'task',
      name: 'Task',
      definition: 'Something to do',
      kindType: 'thought_category' as const,
      active: true,
      neverStale: false,
    },
    {
      id: 'ek-tech',
      key: 'technology',
      name: 'Technology',
      definition: 'Software tool',
      kindType: 'entity_type' as const,
      active: true,
      neverStale: false,
    },
  ]
  const entityKindsByKey = new Map(kinds.map((k) => [k.key, k]))
  return { entityKinds: kinds, entityKindsByKey } as LoadedUserOntology
}

function makeContext(overrides: Partial<EnrichmentContext> = {}): EnrichmentContext {
  return {
    userId: 'user-1',
    thoughtId: 'thought-1',
    normalizedText: 'MCP Bearer key auto-labels agent authorship',
    rawText: 'MCP Bearer key auto-labels agent authorship',
    ontology: makeOntology(),
    profile: { version: 2 },
    groundingProfile: {
      narrativeSummary: 'Engineer building eigenmesh for Hermes agent.',
      facets: { projects: 'empty link frozen project' },
    },
    knownEntities: [{ label: 'MCP', entityType: 'technology' }],
    recentThoughts: [],
    categoryDistribution: new Map([['observation', 3]]),
    communityExcerpts: [],
    completeness: {
      knownEntityCount: 1,
      recentThoughtCount: 0,
      communitySummaryCount: 0,
      hasProfileNotes: false,
      hasGroundingProfile: true,
    },
    ...overrides,
  }
}

function makeBundleResponse(overrides: Record<string, unknown> = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            category: { key: 'observation', confidence: 0.95, alternatives: [] },
            cues: [],
            temporalMentions: [],
            mentions: [{ surface: 'MCP Bearer key', entityType: 'technology', confidence: 0.9 }],
            triples: [],
            askQuestion: 'What did I note about the MCP Bearer key?',
            ...overrides,
          }),
        },
      },
    ],
  }
}

describe('extractEnrichThoughtBundle', () => {
  beforeEach(() => vi.clearAllMocks())

  const bundleInput = (context = makeContext()) => ({
    context,
    capturedAt: new Date('2026-07-03T20:00:10.501Z'),
    timezone: 'Europe/Berlin',
    ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
  })

  describe('askQuestion (suggested question on Ask)', () => {
    it('returns the trimmed question from the same single LLM call (AC-1, AC-7)', async () => {
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ askQuestion: '  What did I need to call the plumber about? ' }),
      )
      const result = await extractEnrichThoughtBundle(
        bundleInput(makeContext({ normalizedText: 'Call the plumber about the kitchen sink' })),
      )
      expect(result.askQuestion).toBe('What did I need to call the plumber about?')
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
      expect(llmChatCompletionMock.mock.calls[0]?.[0]?.logContext).toBe('enrich_thought_bundle')
    })

    it('keeps a German question for a German capture (AC-2, mocked LLM contract)', async () => {
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ askQuestion: 'Wen wollte ich wegen der Spüle anrufen?' }),
      )
      const result = await extractEnrichThoughtBundle(
        bundleInput(makeContext({ normalizedText: 'Klempner wegen der Küchenspüle anrufen' })),
      )
      expect(result.askQuestion).toBe('Wen wollte ich wegen der Spüle anrufen?')
    })

    it('returns null for a greeting (AC-3)', async () => {
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ askQuestion: null, mentions: [] }),
      )
      const result = await extractEnrichThoughtBundle(
        bundleInput(makeContext({ normalizedText: 'hi', rawText: 'hi' })),
      )
      expect(result.askQuestion).toBeNull()
    })

    it('rejects a missing askQuestion key instead of defaulting it', async () => {
      const response = makeBundleResponse()
      const body = JSON.parse(response.choices[0]!.message.content) as Record<string, unknown>
      delete body.askQuestion
      response.choices[0]!.message.content = JSON.stringify(body)
      llmChatCompletionMock.mockResolvedValue(response)
      await expect(extractEnrichThoughtBundle(bundleInput())).rejects.toThrow(/askQuestion/)
    })

    it('rejects a non-string askQuestion and one over the cap', async () => {
      llmChatCompletionMock.mockResolvedValue(makeBundleResponse({ askQuestion: 7 }))
      await expect(extractEnrichThoughtBundle(bundleInput())).rejects.toThrow(/askQuestion/)
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ askQuestion: `${'w'.repeat(95)}?` }),
      )
      await expect(extractEnrichThoughtBundle(bundleInput())).rejects.toThrow(/askQuestion/)
    })

    it('asks for askQuestion in the JSON shape with the SQ-2 rules', () => {
      const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt(bundleInput())
      expect(prompt).toContain('"askQuestion"')
      expect(prompt).toContain(ASK_QUESTION_RULE)
    })
  })

  describe('temporalMentions (a clock time must not lose its date)', () => {
    const dentist = {
      surface: 'Friday at 9am',
      kind: 'appointment',
      startAt: '2026-10-30T09:00:00+01:00',
      timePrecision: 'exact',
      timezone: 'Europe/Berlin',
      isAllDay: false,
      confidence: 0.9,
      semanticSummary: 'Dentist appointment on Friday at 9am',
    }
    const dentistInput = () =>
      bundleInput(
        makeContext({
          normalizedText: 'Dentist appointment on Friday at 9am',
          rawText: 'Dentist appointment on Friday at 9am',
        }),
      )

    it('keeps a clock-time mention with timePrecision exact', async () => {
      llmChatCompletionMock.mockResolvedValue(makeBundleResponse({ temporalMentions: [dentist] }))
      const result = await extractEnrichThoughtBundle(dentistInput())
      expect(result.temporalMentions).toHaveLength(1)
      expect(result.temporalMentions[0]).toMatchObject({
        kind: 'appointment',
        startAt: '2026-10-30T09:00:00+01:00',
        timePrecision: 'exact',
        timezone: 'Europe/Berlin',
      })
    })

    it('rejects timePrecision "hour" instead of dropping the date', async () => {
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ temporalMentions: [{ ...dentist, timePrecision: 'hour' }] }),
      )
      await expect(extractEnrichThoughtBundle(dentistInput())).rejects.toThrow(
        /\[0\]\.timePrecision.*"hour"/,
      )
    })

    it('rejects a mention without a timezone instead of defaulting to UTC', async () => {
      const { timezone: _timezone, ...withoutTimezone } = dentist
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ temporalMentions: [withoutTimezone] }),
      )
      await expect(extractEnrichThoughtBundle(dentistInput())).rejects.toThrow(/timezone/)
    })

    it('rejects a reply without the temporalMentions array instead of reading it as "no date"', async () => {
      const response = makeBundleResponse()
      const body = JSON.parse(response.choices[0]!.message.content) as Record<string, unknown>
      delete body.temporalMentions
      response.choices[0]!.message.content = JSON.stringify(body)
      llmChatCompletionMock.mockResolvedValue(response)
      await expect(extractEnrichThoughtBundle(dentistInput())).rejects.toThrow(
        /temporalMentions must be a JSON array.*missing/,
      )

      llmChatCompletionMock.mockResolvedValue(makeBundleResponse({ temporalMentions: 'none' }))
      await expect(extractEnrichThoughtBundle(dentistInput())).rejects.toThrow(
        /temporalMentions must be a JSON array.*"none"/,
      )
    })

    it('the ingest retry ladder asks again after a bad reply and ends with the good mention', async () => {
      llmChatCompletionMock
        .mockResolvedValueOnce(
          makeBundleResponse({ temporalMentions: [{ ...dentist, timePrecision: 'hour' }] }),
        )
        .mockResolvedValueOnce(makeBundleResponse({ temporalMentions: [dentist] }))

      const result = await runIngestWithRetries(() => extractEnrichThoughtBundle(dentistInput()))

      expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
      expect(result.temporalMentions.map((t) => t.timePrecision)).toEqual(['exact'])
      expect(result.temporalMentions[0]?.startAt).toBe('2026-10-30T09:00:00+01:00')
    })

    it('fails after the ladder (1 + 3 attempts) when every reply is bad', async () => {
      llmChatCompletionMock.mockResolvedValue(
        makeBundleResponse({ temporalMentions: [{ ...dentist, timePrecision: 'hour' }] }),
      )
      await expect(
        runIngestWithRetries(() => extractEnrichThoughtBundle(dentistInput())),
      ).rejects.toThrow(/after 4 attempts.*timePrecision.*"hour"/)
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(4)
    })
  })

  it('returns parsed category, temporal, and entity graph from one LLM call', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse())
    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(result.category.key).toBe('observation')
    expect(result.temporalMentions).toEqual([])
    expect(result.entityGraph.mentions).toHaveLength(1)
  })

  it('parses cues from the single enrich bundle call', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeBundleResponse({ cues: ['mcp bearer key', 'agent authorship'] }),
    )
    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.cues).toEqual(['mcp bearer key', 'agent authorship'])
    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(prompt).toContain('"cues"')
    expect(prompt).not.toContain('memoryType')
  })

  it('accepts category task without requiring memoryType', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeBundleResponse({
        category: { key: 'task', confidence: 0.95, alternatives: [] },
        mentions: [],
      }),
    )
    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.category.key).toBe('task')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('puts capture text before grounding profile in the prompt', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse())
    await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(prompt.indexOf(CAPTURE_PRIMARY_HEADING)).toBeLessThan(prompt.indexOf('Hermes agent'))
    expect(prompt.indexOf('MCP Bearer key auto-labels')).toBeLessThan(
      prompt.indexOf('Hermes agent'),
    )
    expect(prompt).toContain('every extracted field must be justified by this text')
  })

  it('repairs an invalid primary category by promoting a valid alternative (AC-1)', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeBundleResponse({
        category: {
          key: 'perception',
          confidence: 0.9,
          alternatives: [{ key: 'observation', confidence: 0.85 }],
        },
      }),
    )
    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.category.key).toBe('observation')
    expect(result.category.repairedFrom).toBe('perception')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('runs a strict forced-choice retry when all candidates are invalid (AC-2)', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce(
        makeBundleResponse({
          category: {
            key: 'episode',
            confidence: 0.9,
            alternatives: [{ key: 'fact', confidence: 0.8 }],
          },
        }),
      )
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ key: 'task', confidence: 0.99 }) } }],
      })
    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.category.key).toBe('task')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(llmChatCompletionMock.mock.calls[1]?.[0]?.logContext).toBe(
      'enrich_thought_bundle_category_retry',
    )
  })
})

describe('enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt', () => {
  it('includes grounding profile only once', () => {
    const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    const matches = prompt.match(/supplementary background only/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('includes category, cues, and temporal in the JSON contract (single type axis)', () => {
    const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(prompt).not.toContain('memoryType')
    expect(prompt).toContain('"category"')
    expect(prompt).toContain('"cues"')
    expect(prompt).toContain('"temporalMentions"')
    expect(prompt).toContain('"mentions"')
  })

  it('carries the shared temporal element contract with every allowed kind and precision', () => {
    const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(prompt).toContain(TEMPORAL_ELEMENT_CONTRACT)
    for (const value of ['exact', 'day', 'week', 'month', 'fuzzy']) {
      expect(prompt).toContain(`${value}: `)
    }
    expect(prompt).toMatch(/exact: .*clock time/)
  })
})
