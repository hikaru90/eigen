import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichThoughtBundleInternals, extractEnrichThoughtBundle } from './enrich-thought-bundle'
import { CAPTURE_PRIMARY_HEADING } from './enrichment-prompt-sections'
import type { EnrichmentContext } from './enrichment-context'
import type { LoadedUserOntology } from '$lib/server/ontology-db/load-ontology'

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
    },
    {
      id: 'ek-task',
      key: 'task',
      name: 'Task',
      definition: 'Something to do',
      kindType: 'thought_category' as const,
      active: true,
    },
    {
      id: 'ek-tech',
      key: 'technology',
      name: 'Technology',
      definition: 'Software tool',
      kindType: 'entity_type' as const,
      active: true,
    },
  ]
  const entityKindsByKey = new Map(kinds.map((k) => [k.key, k]))
  return {
    entityKinds: kinds,
    entityKindsByKey,
  } as LoadedUserOntology
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
            temporalMentions: [],
            mentions: [{ surface: 'MCP Bearer key', entityType: 'technology', confidence: 0.9 }],
            triples: [],
            ...overrides,
          }),
        },
      },
    ],
  }
}

describe('extractEnrichThoughtBundle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed category, temporal, and entity graph from one LLM call', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse())

    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(llmChatCompletionMock.mock.calls[0]?.[0]?.logContext).toBe('enrich_thought_bundle')
    expect(result.category.key).toBe('observation')
    expect(result.temporalMentions).toEqual([])
    expect(result.entityGraph.mentions).toHaveLength(1)
  })

  it('does not ask the model for memoryType or cues (separated path)', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse())

    await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })

    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(prompt).not.toContain('"memoryType"')
    expect(prompt).not.toContain('"cues"')
    expect(prompt).not.toContain('FORBIDDEN memoryType values')
    expect(prompt).not.toContain('choose ONLY from')
    const system = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[0]?.content as string
    expect(system).toMatch(/Do not classify memoryType/i)
  })

  it('accepts category task without requiring memoryType in the same response', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeBundleResponse({
        category: { key: 'task', confidence: 0.95, alternatives: [] },
        mentions: [],
      }),
    )

    const result = await extractEnrichThoughtBundle({
      context: makeContext({
        normalizedText: 'Todo: Hydra - make NPT 3/4 thread tapered on the outer side.',
        rawText: 'Todo: Hydra - make NPT 3/4 thread tapered on the outer side.',
      }),
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

  it('ignores stray memoryType fields in the model response', async () => {
    llmChatCompletionMock.mockResolvedValue(
      makeBundleResponse({
        memoryType: 'idea',
        cues: ['should be ignored'],
      }),
    )

    const result = await extractEnrichThoughtBundle({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })

    expect(result.category.key).toBe('observation')
    expect(result).not.toHaveProperty('metadata')
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

  it('omits memoryType from the JSON contract', () => {
    const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt({
      context: makeContext(),
      capturedAt: new Date('2026-07-03T20:00:10.501Z'),
      timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(prompt).not.toContain('"memoryType"')
    expect(prompt).toContain('"category"')
    expect(prompt).toContain('"temporalMentions"')
    expect(prompt).toContain('"mentions"')
  })
})
