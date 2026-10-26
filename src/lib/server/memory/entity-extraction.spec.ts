import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptEntityTriple,
  extractEntityGraphBundle,
  extractEntityTriples,
  filterAcceptedEntityTriples,
  parseEntityMentions,
  parseEntityTriples,
  resolveEntityTypeKey,
  resolveTripleEndpointEntityId,
} from './entity-extraction'

const { llmChatCompletionMock } = vi.hoisted(() => ({
  llmChatCompletionMock: vi.fn(),
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

const ONTOLOGY_KINDS_FOR_TESTS = [
  { key: 'person', name: 'Person', definition: 'A human being' },
  { key: 'memory', name: 'Memory', definition: 'Past experience' },
  { key: 'place', name: 'Place', definition: 'A location' },
]

const ALLOWED_TEST_KEYS = new Set(ONTOLOGY_KINDS_FOR_TESTS.map((k) => k.key))

describe('resolveEntityTypeKey', () => {
  it('matches ontology keys case-insensitively', () => {
    const allowed = new Set(['person', 'technology', 'organization'])
    expect(resolveEntityTypeKey('Person', allowed)).toBe('person')
    expect(resolveEntityTypeKey('TECHNOLOGY', allowed)).toBe('technology')
  })

  it('returns null for shorthand drift — LLM must return ontology keys', () => {
    const allowed = new Set(['organization', 'technology', 'place'])
    expect(resolveEntityTypeKey('org', allowed)).toBeNull()
    expect(resolveEntityTypeKey('device', allowed)).toBeNull()
  })

  it('returns null for empty or whitespace-only input', () => {
    const allowed = new Set(['person'])
    expect(resolveEntityTypeKey('', allowed)).toBeNull()
    expect(resolveEntityTypeKey('   ', allowed)).toBeNull()
  })

  it('returns exact key when already present in allowed set', () => {
    const allowed = new Set(['person', 'place'])
    expect(resolveEntityTypeKey('person', allowed)).toBe('person')
  })

  it('returns null when synonym maps to a key not in allowed', () => {
    const allowed = new Set(['person'])
    expect(resolveEntityTypeKey('org', allowed)).toBeNull()
    expect(resolveEntityTypeKey('location', allowed)).toBeNull()
  })

  it('returns null for unknown types with no synonym mapping', () => {
    const allowed = new Set(['person', 'place'])
    expect(resolveEntityTypeKey('unknown_type', allowed)).toBeNull()
  })
})

describe('parseEntityMentions', () => {
  it('accepts Title Case entityType when it matches a canonical ontology key', () => {
    const out = parseEntityMentions(
      '[{"surface":"StealthArray","entityType":"Technology","confidence":0.9}]',
      new Set(['person', 'place', 'technology', 'concept']),
    )
    expect(out).toEqual([{ surface: 'StealthArray', entityType: 'technology', confidence: 0.9 }])
  })

  it('drops mentions when entityType is not an exact ontology key', () => {
    const allowed = new Set(['person', 'place', 'technology', 'organization', 'concept', 'event'])
    const out = parseEntityMentions(
      JSON.stringify([
        { surface: 'MIS TLIF', entityType: 'procedure', confidence: 0.9 },
        { surface: 'StealthArray navigation', entityType: 'technology', confidence: 0.8 },
      ]),
      allowed,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ surface: 'StealthArray navigation', entityType: 'technology' })
  })

  it('rejects human/abstract drift labels without synonym remapping', () => {
    const allowed = new Set(['person', 'concept'])
    expect(() =>
      parseEntityMentions(
        JSON.stringify([
          { surface: 'Jonas', entityType: 'human', confidence: 0.9 },
          { surface: 'silence', entityType: 'abstract', confidence: 0.85 },
        ]),
        allowed,
      ),
    ).toThrow(/none had a valid entityType.*human, abstract/)
  })

  it('parses and filters types not in the ontology key set', () => {
    const out = parseEntityMentions(
      '[{"surface":"  Sam  ","entityType":"person","confidence":0.9},{"surface":"X","entityType":"unknown_type","confidence":1}]',
      ALLOWED_TEST_KEYS,
    )
    expect(out).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 0.9 }])
  })

  it('drops entries that are not objects or are missing surface', () => {
    const out = parseEntityMentions(
      '["bad", null, {"surface":"","entityType":"memory","confidence":1}, {"surface":"Alex","entityType":"memory"}]',
      ALLOWED_TEST_KEYS,
    )
    expect(out).toEqual([{ surface: 'Alex', entityType: 'memory', confidence: 0 }])
  })

  it('drops entries where surface or entityType are not strings', () => {
    const out = parseEntityMentions(
      '[{"surface":42,"entityType":"person","confidence":1},{"surface":"Alex","entityType":42,"confidence":1},{"surface":"Sam","entityType":"person","confidence":1}]',
      ALLOWED_TEST_KEYS,
    )
    expect(out).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 1 }])
  })

  it('clamps numeric confidence outside [0,1] and treats non-numeric as 0', () => {
    const out = parseEntityMentions(
      '[{"surface":"A","entityType":"place","confidence":5},{"surface":"B","entityType":"place","confidence":-3},{"surface":"C","entityType":"place","confidence":"x"},{"surface":"D","entityType":"place","confidence":null}]',
      ALLOWED_TEST_KEYS,
    )
    expect(out.map((m) => m.confidence)).toEqual([1, 0, 0, 0])
  })

  it('keeps all LLM mentions — greeting filtering is prompt-only', () => {
    const out = parseEntityMentions(
      '[{"surface":"Hallo","entityType":"person","confidence":0.9},{"surface":"Alex","entityType":"person","confidence":0.95}]',
      ALLOWED_TEST_KEYS,
    )
    expect(out).toHaveLength(2)
  })

  it('throws when JSON is not an array', () => {
    expect(() => parseEntityMentions('{"surface":"A"}', ALLOWED_TEST_KEYS)).toThrow(
      /must be a JSON array/,
    )
  })

  it('throws when the model returned mentions but every one lacks a valid ontology entityType', () => {
    expect(() =>
      parseEntityMentions(
        '[{"surface":"Sam","entityType":"bogus","confidence":0.9}]',
        ALLOWED_TEST_KEYS,
      ),
    ).toThrow(/none had a valid entityType.*bogus/)
  })

  it('returns [] for an empty array — a legitimate "nothing to extract" judgement', () => {
    expect(parseEntityMentions('[]', ALLOWED_TEST_KEYS)).toEqual([])
  })
})

describe('acceptEntityTriple', () => {
  it('accepts high-confidence related_to without lexical substring gate', () => {
    expect(
      acceptEntityTriple(
        { subject: 'Sam', object: 'Mars', predicate: 'related_to', confidence: 0.9 },
        'sam met alex in berlin',
      ),
    ).toBe(true)
  })

  it('rejects specific predicates below default confidence floor', () => {
    expect(
      acceptEntityTriple(
        { subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.5 },
        'sam in berlin',
      ),
    ).toBe(false)
  })

  it('accepts non-related_to predicates at or above default confidence floor', () => {
    expect(
      acceptEntityTriple(
        { subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.55 },
        'sam in berlin',
      ),
    ).toBe(true)
  })

  it('rejects related_to below the higher confidence floor even with lexical support', () => {
    expect(
      acceptEntityTriple(
        { subject: 'Sam', object: 'Berlin', predicate: 'related_to', confidence: 0.7 },
        'sam traveled to berlin',
      ),
    ).toBe(false)
  })
})

describe('filterAcceptedEntityTriples', () => {
  it('filters triples below confidence floors only', () => {
    const out = filterAcceptedEntityTriples({
      normalizedText: 'sam in berlin',
      triples: [
        { subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.8 },
        { subject: 'Sam', object: 'Mars', predicate: 'related_to', confidence: 0.9 },
      ],
    })
    expect(out).toHaveLength(2)
  })
})

describe('parseEntityTriples', () => {
  it('keeps triples whose endpoints are allowed surfaces', () => {
    const allowed = new Set(['Sam', 'Berlin'])
    const out = parseEntityTriples(
      '[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.8},{"subject":"Sam","object":"Mars","predicate":"located_in","confidence":0.8}]',
      allowed,
    )
    expect(out).toHaveLength(1)
    expect(out[0].predicate).toBe('located_in')
  })

  it('drops entries with invalid predicate or empty endpoints', () => {
    const allowed = new Set(['A', 'B'])
    const out = parseEntityTriples(
      '[{"subject":"A","object":"B","predicate":"invented"},{"subject":"","object":"B","predicate":"related_to"},"bad"]',
      allowed,
    )
    expect(out).toEqual([])
  })

  it('drops entries with non-string subject, object, or predicate fields', () => {
    const allowed = new Set(['A', 'B'])
    const out = parseEntityTriples(
      '[{"subject":1,"object":"B","predicate":"related_to"},{"subject":"A","object":2,"predicate":"related_to"},{"subject":"A","object":"B","predicate":3}]',
      allowed,
    )
    expect(out).toEqual([])
  })

  it('throws when JSON is not an array', () => {
    expect(() => parseEntityTriples('{"x":1}', new Set())).toThrow(/must be a JSON array/)
  })

  it('clamps triple confidence outside [0,1] and treats non-numeric as 0', () => {
    const allowed = new Set(['A', 'B'])
    const out = parseEntityTriples(
      '[{"subject":"A","object":"B","predicate":"related_to","confidence":2},{"subject":"A","object":"B","predicate":"knows","confidence":"x"}]',
      allowed,
    )
    expect(out).toHaveLength(2)
    expect(out[0].confidence).toBe(1)
    expect(out[1].confidence).toBe(0)
  })

  it('allows graph entity label as object when subject is a mention', () => {
    const mentions = new Set(['fish'])
    const graphLabels = new Set(['picnic'])
    const out = parseEntityTriples(
      '[{"subject":"fish","object":"picnic","predicate":"part_of","confidence":0.9}]',
      mentions,
      graphLabels,
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ subject: 'fish', object: 'picnic', predicate: 'part_of' })
  })

  it('rejects triples where neither endpoint is a mention', () => {
    const mentions = new Set(['fish'])
    const graphLabels = new Set(['picnic', 'bread'])
    const out = parseEntityTriples(
      '[{"subject":"picnic","object":"bread","predicate":"related_to","confidence":0.9}]',
      mentions,
      graphLabels,
    )
    expect(out).toHaveLength(0)
  })
})

describe('resolveTripleEndpointEntityId', () => {
  it('resolves mention surface and graph label', () => {
    const surfaceMap = new Map([['fish', 'fish-id']])
    const graphMap = new Map([['picnic', 'picnic-id']])
    expect(resolveTripleEndpointEntityId('fish', surfaceMap, graphMap)).toBe('fish-id')
    expect(resolveTripleEndpointEntityId('picnic', surfaceMap, graphMap)).toBe('picnic-id')
  })
})

function chatResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

describe('extractEntityGraphBundle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function graphBundleResponse(mentions: unknown[], triples: unknown[] = []) {
    return chatResponse(JSON.stringify({ mentions, triples }))
  }

  it('returns parsed mentions and triples from a valid graph bundle', async () => {
    llmChatCompletionMock.mockResolvedValue(
      graphBundleResponse(
        [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }],
        [{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.8 }],
      ),
    )

    const out = await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText: 'Sam in Berlin',
      ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
    })

    expect(out.mentions).toEqual([{ surface: 'Sam', entityType: 'person', confidence: 0.9 }])
    expect(out.triples).toEqual([])
  })

  it('throws when ontologyEntityKinds is empty', async () => {
    await expect(
      extractEntityGraphBundle({ userId: 'u1', normalizedText: 'x', ontologyEntityKinds: [] }),
    ).rejects.toThrow(/at least one ontology entity kind/)
  })

  it('throws when graph JSON is invalid — a broken response is not "no entities"', async () => {
    llmChatCompletionMock.mockResolvedValue(chatResponse('not-json'))

    await expect(
      extractEntityGraphBundle({
        userId: 'u1',
        normalizedText: 'x'.repeat(120),
        ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
      }),
    ).rejects.toThrow()
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('throws when parsed output is not an object', async () => {
    llmChatCompletionMock.mockResolvedValue(chatResponse('null'))

    await expect(
      extractEntityGraphBundle({
        userId: 'u1',
        normalizedText: 'Sam was here',
        ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
      }),
    ).rejects.toThrow(/must be a JSON object/)
  })

  it('throws when the LLM gateway fails (no silent empty fallback)', async () => {
    llmChatCompletionMock.mockRejectedValue(new Error('gateway 502'))

    await expect(
      extractEntityGraphBundle({
        userId: 'u1',
        normalizedText: 'x'.repeat(120),
        ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
      }),
    ).rejects.toThrow('gateway 502')
  })

  it('throws when every returned mention has an off-catalog entityType', async () => {
    llmChatCompletionMock.mockResolvedValue(
      graphBundleResponse([{ surface: 'L4-L5', entityType: 'procedure', confidence: 0.9 }]),
    )

    await expect(
      extractEntityGraphBundle({
        userId: 'u1',
        normalizedText: 'x'.repeat(120),
        ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
      }),
    ).rejects.toThrow(/none had a valid entityType/)
  })

  it('treats non-array mentions and triples as empty arrays', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        JSON.stringify({
          mentions: { surface: 'Sam', entityType: 'person' },
          triples: 'bad',
        }),
      ),
    )

    const out = await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText: 'Sam was here',
      ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
    })

    expect(out).toEqual({ mentions: [], triples: [] })
  })

  it('includes surface-integrity, type guidance, and part_of triple rules in the graph bundle prompt', async () => {
    llmChatCompletionMock.mockResolvedValue(
      graphBundleResponse([
        { surface: 'Herb Roast Chicken', entityType: 'artifact', confidence: 0.9 },
      ]),
    )

    await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText: '# Herb Roast Chicken\n* two lemons',
      ontologyEntityKinds: [
        ...ONTOLOGY_KINDS_FOR_TESTS,
        { key: 'artifact', name: 'Artifact', definition: 'A created object' },
      ],
    })

    const prompt = String(llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content)
    expect(prompt).toContain('Herb Roast Chicken')
    expect(prompt).toContain('part_of triples')
    expect(prompt).toContain('artifact for documents/recipes/named dishes')
    const systemPrompt = String(llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[0]?.content)
    expect(systemPrompt).toContain('Keep multi-word titles as single surfaces')
  })

  it('includes enrichment context with graph entity ids and community themes', async () => {
    llmChatCompletionMock.mockResolvedValue(
      graphBundleResponse(
        [
          { surface: 'fish', entityType: 'concept', confidence: 0.9 },
          { surface: 'picnic', entityType: 'event', confidence: 0.85 },
        ],
        [{ subject: 'fish', object: 'picnic', predicate: 'part_of', confidence: 0.9 }],
      ),
    )

    await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText: 'I need to bring fish for the picnic',
      ontologyEntityKinds: [
        ...ONTOLOGY_KINDS_FOR_TESTS,
        { key: 'event', name: 'Event', definition: 'An occurrence' },
        { key: 'concept', name: 'Concept', definition: 'An idea or thing' },
      ],
      enrichmentContext: {
        graphEntities: [
          {
            entityId: 'picnic-uuid',
            label: 'picnic',
            entityType: 'event',
            source: 'lexical',
          },
        ],
        communityExcerpts: [
          { communityId: 'comm-1', level: 1, summaryText: 'Planning outdoor meals and picnics' },
        ],
        groundingProfile: {
          narrativeSummary: 'Enjoys weekend picnics with family.',
          facets: {},
        },
      },
    })

    const prompt = String(llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content)
    expect(prompt).toContain('id=picnic-uuid')
    expect(prompt).toContain('community summaries')
    expect(prompt).toContain('User grounding profile')
    expect(prompt).toContain('bring fish for the picnic')
  })

  it('includes knownEntities in the graph bundle prompt', async () => {
    llmChatCompletionMock.mockResolvedValue(
      graphBundleResponse([{ surface: 'Jonas', entityType: 'person', confidence: 0.9 }]),
    )

    await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText: 'Jonas was here',
      ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
      knownEntities: [{ label: 'Jonas', entityType: 'person' }],
    })

    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content
    expect(String(prompt)).toContain('Known entities already in memory')
    expect(String(prompt)).toContain('Jonas (person)')
  })

  it('accepts a zero-mention answer from one LLM call without re-asking', async () => {
    llmChatCompletionMock.mockResolvedValue(graphBundleResponse([]))

    const out = await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText:
        'Could you help me improve the language in this short reflective piece so it flows more smoothly and paints a sharper picture?',
      ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
    })

    expect(out).toEqual({ mentions: [], triples: [] })
    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    const prompt = String(llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content)
    expect(prompt).not.toMatch(/never return an empty|at least 2 mentions/i)
  })

  it('keeps triples whose endpoints match parsed mention surfaces', async () => {
    llmChatCompletionMock.mockResolvedValue(
      graphBundleResponse(
        [
          { surface: 'Sam', entityType: 'person', confidence: 0.9 },
          { surface: 'Berlin', entityType: 'place', confidence: 0.8 },
        ],
        [{ subject: 'Sam', object: 'Berlin', predicate: 'located_in', confidence: 0.8 }],
      ),
    )

    const out = await extractEntityGraphBundle({
      userId: 'u1',
      normalizedText: 'Sam in Berlin',
      ontologyEntityKinds: ONTOLOGY_KINDS_FOR_TESTS,
    })

    expect(out.triples).toHaveLength(1)
    expect(out.triples[0]).toMatchObject({
      subject: 'Sam',
      object: 'Berlin',
      predicate: 'located_in',
    })
  })
})

describe('extractEntityTriples', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits with an empty array when no mentions are provided', async () => {
    const out = await extractEntityTriples({
      userId: 'u1',
      normalizedText: 'x',
      mentions: [],
    })
    expect(out).toEqual([])
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('returns parsed triples from the chat completion content', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        '{"triples":[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.5}]}',
      ),
    )
    const mentions = [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]
    const out = await extractEntityTriples({
      userId: 'u1',
      normalizedText: 'Sam in Berlin',
      mentions,
    })
    expect(out).toEqual([])
  })

  it('returns triples when endpoints match mention surfaces', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        '{"triples":[{"subject":"Sam","object":"Berlin","predicate":"located_in","confidence":0.6}]}',
      ),
    )
    const mentions = [
      { surface: 'Sam', entityType: 'person', confidence: 0.9 },
      { surface: 'Berlin', entityType: 'memory', confidence: 0.8 },
    ]
    const out = await extractEntityTriples({
      userId: 'u1',
      normalizedText: 'Sam in Berlin',
      mentions,
    })
    expect(out).toHaveLength(1)
    expect(out[0].predicate).toBe('located_in')
  })

  it('throws when the LLM response is malformed', async () => {
    llmChatCompletionMock.mockResolvedValue({ choices: [] })
    const mentions = [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]
    await expect(
      extractEntityTriples({
        userId: 'u1',
        normalizedText: 'Sam was here',
        mentions,
      }),
    ).rejects.toThrow(/no choices/)
  })

  it.each(['{"subject":"Sam"}', '[]'])(
    'throws when triple JSON is not a { triples: [...] } object (%s)',
    async (content) => {
      llmChatCompletionMock.mockResolvedValue(chatResponse(content))
      const mentions = [{ surface: 'Sam', entityType: 'person', confidence: 0.9 }]
      await expect(
        extractEntityTriples({
          userId: 'u1',
          normalizedText: 'Sam was here',
          mentions,
        }),
      ).rejects.toThrow(/"triples" array/)
    },
  )

  it('includes mention surfaces in the triple extraction prompt', async () => {
    llmChatCompletionMock.mockResolvedValue(chatResponse('{"triples":[]}'))
    const mentions = [
      { surface: 'Sam', entityType: 'person', confidence: 0.9 },
      { surface: 'Berlin', entityType: 'place', confidence: 0.8 },
    ]
    await extractEntityTriples({
      userId: 'u1',
      normalizedText: 'Sam in Berlin',
      mentions,
    })
    const prompt = llmChatCompletionMock.mock.calls[0]?.[0]?.messages?.[1]?.content
    expect(String(prompt)).toContain('- Sam (person)')
    expect(String(prompt)).toContain('- Berlin (place)')
    expect(llmChatCompletionMock.mock.calls[0]?.[0]?.responseFormat).toBe('json_object')
  })
})
