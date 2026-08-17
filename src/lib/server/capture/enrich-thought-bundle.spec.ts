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
    { id: 'ek-obs', key: 'observation', name: 'Observation', definition: 'Something noticed', kindType: 'thought_category' as const, active: true, neverStale: false },
    { id: 'ek-task', key: 'task', name: 'Task', definition: 'Something to do', kindType: 'thought_category' as const, active: true, neverStale: false },
    { id: 'ek-tech', key: 'technology', name: 'Technology', definition: 'Software tool', kindType: 'entity_type' as const, active: true, neverStale: false },
  ]
  const entityKindsByKey = new Map(kinds.map((k) => [k.key, k]))
  return { entityKinds: kinds, entityKindsByKey } as LoadedUserOntology
}

function makeContext(overrides: Partial<EnrichmentContext> = {}): EnrichmentContext {
  return {
    userId: 'user-1', thoughtId: 'thought-1',
    normalizedText: 'MCP Bearer key auto-labels agent authorship',
    rawText: 'MCP Bearer key auto-labels agent authorship',
    ontology: makeOntology(), profile: { version: 2 },
    groundingProfile: { narrativeSummary: 'Engineer building eigenmesh for Hermes agent.', facets: { projects: 'empty link frozen project' } },
    knownEntities: [{ label: 'MCP', entityType: 'technology' }], recentThoughts: [],
    categoryDistribution: new Map([['observation', 3]]), communityExcerpts: [],
    completeness: { knownEntityCount: 1, recentThoughtCount: 0, communitySummaryCount: 0, hasProfileNotes: false, hasGroundingProfile: true },
    ...overrides,
  }
}

function makeBundleResponse(overrides: Record<string, unknown> = {}) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({
          category: { key: 'observation', confidence: 0.95, alternatives: [] },
          cues: [], temporalMentions: [],
          mentions: [{ surface: 'MCP Bearer key', entityType: 'technology', confidence: 0.9 }],
          triples: [], ...overrides,
        }),
      },
    }],
  }
}

describe('extractEnrichThoughtBundle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed category, temporal, and entity graph from one LLM call', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse())
    const result = await extractEnrichThoughtBundle({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    expect(result.category.key).toBe('observation')
    expect(result.temporalMentions).toEqual([])
    expect(result.entityGraph.mentions).toHaveLength(1)
  })

  it('parses cues from the single enrich bundle call', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse({ cues: ['mcp bearer key', 'agent authorship'] }))
    const result = await extractEnrichThoughtBundle({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.cues).toEqual(['mcp bearer key', 'agent authorship'])
    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(prompt).toContain('"cues"')
    expect(prompt).not.toContain('memoryType')
  })

  it('accepts category task without requiring memoryType', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse({ category: { key: 'task', confidence: 0.95, alternatives: [] }, mentions: [] }))
    const result = await extractEnrichThoughtBundle({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.category.key).toBe('task')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('puts capture text before grounding profile in the prompt', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse())
    await extractEnrichThoughtBundle({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content as string
    expect(prompt.indexOf(CAPTURE_PRIMARY_HEADING)).toBeLessThan(prompt.indexOf('Hermes agent'))
    expect(prompt.indexOf('MCP Bearer key auto-labels')).toBeLessThan(prompt.indexOf('Hermes agent'))
    expect(prompt).toContain('every extracted field must be justified by this text')
  })

  it('repairs an invalid primary category by promoting a valid alternative (AC-1)', async () => {
    llmChatCompletionMock.mockResolvedValue(makeBundleResponse({
      category: { key: 'perception', confidence: 0.9, alternatives: [{ key: 'observation', confidence: 0.85 }] },
    }))
    const result = await extractEnrichThoughtBundle({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.category.key).toBe('observation')
    expect(result.category.repairedFrom).toBe('perception')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('runs a strict forced-choice retry when all candidates are invalid (AC-2)', async () => {
    llmChatCompletionMock
      .mockResolvedValueOnce(makeBundleResponse({
        category: { key: 'episode', confidence: 0.9, alternatives: [{ key: 'fact', confidence: 0.8 }] },
      }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: JSON.stringify({ key: 'task', confidence: 0.99 }) } }],
      })
    const result = await extractEnrichThoughtBundle({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(result.category.key).toBe('task')
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(2)
    expect(llmChatCompletionMock.mock.calls[1]?.[0]?.logContext).toBe('enrich_thought_bundle_category_retry')
  })
})

describe('enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt', () => {
  it('includes grounding profile only once', () => {
    const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    const matches = prompt.match(/supplementary background only/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('includes category, cues, and temporal in the JSON contract (single type axis)', () => {
    const prompt = enrichThoughtBundleInternals.buildEnrichThoughtBundlePrompt({
      context: makeContext(), capturedAt: new Date('2026-07-03T20:00:10.501Z'), timezone: 'Europe/Berlin',
      ontologyEntityKinds: [{ key: 'technology', name: 'Technology', definition: 'Software tool' }],
    })
    expect(prompt).not.toContain('memoryType')
    expect(prompt).toContain('"category"')
    expect(prompt).toContain('"cues"')
    expect(prompt).toContain('"temporalMentions"')
    expect(prompt).toContain('"mentions"')
  })
})

