import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval'
import {
  composeAnswer,
  detectContradictions,
  extractProfileDetailsBlock,
  extractQuestionSubjectName,
  extractRetrievalHints,
  findInvalidCitationIds,
  findInvalidProfileCitationIds,
  formatComposedAnswerForUser,
  formatCommunityThemesForPrompt,
  formatGroundingProfileForCompose,
  formatThoughtsForPrompt,
  formatTextFilesForPrompt,
  GROUNDING_PROFILE_CITATION_ID,
  insufficientMemoryAnswer,
  narrowComposeContextToQuestionFocus,
  prioritizePersonNamedThoughts,
  type RetrievalContextItem,
} from './compose-answer'

const {
  searchThoughtsMock,
  searchTextFilesMock,
  classifyQueryIntentMock,
  fetchTemporalEventSeedsMock,
  resolveTemporalHintBindingsMock,
  fetchRelevantCommunitySummariesMock,
  loadGroundingProfileForEnrichmentMock,
  llmChatCompletionMock,
  findTemporalSchedulingConflictsMock,
  createThoughtEmbeddingMock,
  createThoughtEmbeddingsMock,
  lexicalSearchMock,
  graphOnlySearchByQueryMock,
  dbWhereMock,
} = vi.hoisted(() => ({
  searchThoughtsMock: vi.fn(),
  searchTextFilesMock: vi.fn(),
  classifyQueryIntentMock: vi.fn(),
  fetchTemporalEventSeedsMock: vi.fn(),
  resolveTemporalHintBindingsMock: vi.fn(),
  fetchRelevantCommunitySummariesMock: vi.fn(),
  loadGroundingProfileForEnrichmentMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
  findTemporalSchedulingConflictsMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  createThoughtEmbeddingsMock: vi.fn(),
  lexicalSearchMock: vi.fn(),
  graphOnlySearchByQueryMock: vi.fn(),
  dbWhereMock: vi.fn(),
}))

vi.mock('$lib/server/retrieval/service', () => ({
  searchThoughts: searchThoughtsMock,
}))

vi.mock('$lib/server/text-files/service', () => ({
  searchTextFiles: searchTextFilesMock,
}))

vi.mock('$lib/server/retrieval/classify-query-intent', () => ({
  classifyQueryIntent: classifyQueryIntentMock,
}))

vi.mock('$lib/server/retrieval/resolve-temporal-hint-bindings', () => ({
  resolveTemporalHintBindings: resolveTemporalHintBindingsMock,
  candidatesFromTemporalSeeds: (
    seeds: Array<{
      eventId: string
      thoughtId: string
      semanticSummary: string
      startAt: Date | null
      kind: string
    }>,
  ) =>
    seeds.map((seed) => ({
      eventId: seed.eventId,
      thoughtId: seed.thoughtId,
      semanticSummary: seed.semanticSummary,
      startAt: seed.startAt?.toISOString() ?? null,
      kind: seed.kind,
    })),
}))

vi.mock('$lib/server/retrieval/temporal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/retrieval/temporal')>()
  return {
    ...actual,
    fetchTemporalEventSeeds: fetchTemporalEventSeedsMock,
    fetchTemporalEventSeedsForHints: fetchTemporalEventSeedsMock,
  }
})

vi.mock('$lib/server/retrieval/global', () => ({
  fetchRelevantCommunitySummaries: fetchRelevantCommunitySummariesMock,
}))

vi.mock('$lib/server/grounding/profile', () => ({
  loadGroundingProfileForEnrichment: loadGroundingProfileForEnrichmentMock,
}))

vi.mock('$lib/server/llm/llm-client', () => ({
  llmChatCompletion: llmChatCompletionMock,
}))

vi.mock('$lib/server/llm/embedding', () => ({
  createThoughtEmbedding: createThoughtEmbeddingMock,
  createThoughtEmbeddings: createThoughtEmbeddingsMock,
}))

vi.mock('$lib/server/retrieval/lexical', () => ({
  lexicalSearch: lexicalSearchMock,
}))

vi.mock('$lib/server/graph/age', () => ({
  graphOnlySearchByQuery: graphOnlySearchByQueryMock,
}))

vi.mock('$lib/server/retrieval/temporal-conflicts', () => ({
  findTemporalSchedulingConflicts: findTemporalSchedulingConflictsMock,
  formatTemporalConflictsForPrompt: (conflicts: unknown[]) =>
    conflicts.length > 0 ? '\n\nTemporal scheduling conflicts (from memory graph):\n' : '',
  isSchedulingConflictQuery: (q: string) => /conflict|scheduling/i.test(q),
}))

vi.mock('$lib/server/db', () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: dbWhereMock,
      }),
    }),
  }),
}))

function chatResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

const FIXED_DATE = new Date('2026-01-01T00:00:00Z')

const noTemporal = {
  temporalStatus: 'none' as const,
  temporalEvents: [] as RetrievalContextItem['temporalEvents'],
}

const sampleRetrieval = [
  {
    id: 't_001',
    normalizedText: 'Marcus suggested rice flour for the banneton.',
    category: 'idea',
    score: 0.82,
    vectorScore: 0.9,
    graphScore: 0.5,
    metadata: {},
    createdAt: FIXED_DATE,
    memoryType: null,
  },
  {
    id: 't_002',
    normalizedText: 'Tartine sells day-old loaves for half price after 3pm.',
    category: 'memory',
    score: 0.71,
    vectorScore: 0.75,
    graphScore: 0.6,
    metadata: {},
    createdAt: FIXED_DATE,
    memoryType: null,
  },
]

describe('extractQuestionSubjectName', () => {
  it('returns undefined — subject extraction is LLM-judged', () => {
    expect(extractQuestionSubjectName('what is Marcus allergic to')).toBeUndefined()
    expect(
      extractQuestionSubjectName('What does Jonas need before doing creative work?'),
    ).toBeUndefined()
  })
})

describe('prioritizePersonNamedThoughts', () => {
  const base = (id: string, text: string, score: number): RetrievalContextItem => ({
    id,
    normalizedText: text,
    category: 'observation',
    score,
    vectorScore: score,
    graphScore: 0,
    createdAt: FIXED_DATE,
    isStale: false,
    ...noTemporal,
  })

  it('preserves retrieval order without person-name boosting', () => {
    const ordered = prioritizePersonNamedThoughts(
      'What does Jonas need before doing creative work?',
      [
        base('a', 'Schedule creative work when personal energy is historically highest.', 0.9),
        base('b', 'Before any creative work, Jonas needs at least 20 minutes of silence.', 0.4),
      ],
      8,
    )
    expect(ordered[0]?.id).toBe('a')
  })
})

describe('narrowComposeContextToQuestionFocus', () => {
  it('passes through all items without regex narrowing', () => {
    const out = narrowComposeContextToQuestionFocus('what is Marcus allergic to', [
      {
        id: 'a',
        normalizedText: 'Started a new sourdough starter today.',
        category: 'task',
        score: 0.9,
        vectorScore: 0.9,
        graphScore: 0,
        createdAt: FIXED_DATE,
        isStale: false,
        ...noTemporal,
      },
      {
        id: 'b',
        normalizedText: "Marcus is allergic to walnuts. Don't bring the walnut levain.",
        category: 'observation',
        score: 0.5,
        vectorScore: 0.5,
        graphScore: 0,
        createdAt: FIXED_DATE,
        isStale: false,
        ...noTemporal,
      },
    ])
    expect(out.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('does not filter by question name token', () => {
    const out = narrowComposeContextToQuestionFocus('Wer ist Clemi?', [
      {
        id: 'a',
        normalizedText: 'annie ist meine schwester',
        category: 'reference',
        score: 1,
        vectorScore: 1,
        graphScore: 0,
        createdAt: FIXED_DATE,
        isStale: false,
        ...noTemporal,
      },
      {
        id: 'b',
        normalizedText: 'clemi ist clemens',
        category: 'reference',
        score: 1,
        vectorScore: 1,
        graphScore: 0,
        createdAt: FIXED_DATE,
        isStale: false,
        ...noTemporal,
      },
    ])
    expect(out).toHaveLength(2)
  })
})

describe('formatComposedAnswerForUser', () => {
  it('normalizes legacy citation tokens to [id=uuid]', () => {
    expect(
      formatComposedAnswerForUser(
        'Answer: Home. [<id=d428954a-aae1-4565-a162-9f38b5536d2e>]\nEvidence:\n- Working from home [t1]\nUnknown:\n- none',
      ),
    ).toContain('[id=d428954a-aae1-4565-a162-9f38b5536d2e]')
    expect(formatComposedAnswerForUser('Fact [t1] here.')).toBe('Fact [id=t1] here.')
  })
})

describe('findInvalidCitationIds', () => {
  it('flags citation ids not in the allow-list', () => {
    const invalid = findInvalidCitationIds('Fact [a] and bad [z]', new Set(['a']))
    expect(invalid).toEqual(['z'])
  })
})

describe('profile citation validation', () => {
  it('ignores bracket tokens outside the Details section', () => {
    const answer = [
      'Summary: You build Eigen [not-a-real-id].',
      'Details:',
      '- You build Eigen [t_001]',
      'Themes: product work.',
    ].join('\n')
    expect(findInvalidProfileCitationIds(answer, new Set(['t_001']))).toEqual([])
  })

  it('flags invalid ids only inside Details', () => {
    const answer = 'Summary: Hi\nDetails:\n- Fact [t_999]\nThemes: none'
    expect(findInvalidProfileCitationIds(answer, new Set(['t_001']))).toEqual(['t_999'])
  })

  it('extracts the Details block for validation', () => {
    expect(extractProfileDetailsBlock('Summary: x\nDetails:\n- a [t_1]\nThemes: y')).toBe(
      '- a [t_1]',
    )
  })
})

describe('extractRetrievalHints', () => {
  it('always returns undefined — hint extraction removed', () => {
    expect(extractRetrievalHints('Wer ist Clemi?')).toBeUndefined()
    expect(extractRetrievalHints('was weißt du über mich?')).toBeUndefined()
  })
})

describe('formatThoughtsForPrompt', () => {
  it('annotates expired temporal events in the thought header', () => {
    const now = new Date('2026-06-05T00:00:00.000Z')
    const prompt = formatThoughtsForPrompt(
      [
        {
          id: 't_skate',
          normalizedText: 'I want to go inline skating today.',
          category: 'task',
          score: 0.8,
          vectorScore: 0.8,
          graphScore: 0,
          createdAt: new Date('2026-05-28T00:00:00.000Z'),
          isStale: false,
          temporalStatus: 'expired',
          temporalEvents: [
            {
              kind: 'reminder',
              semanticSummary: 'go inline skating today',
              activePeriod: '[2026-05-28T00:00:00.000Z,2026-05-29T00:00:00.000Z)',
              expired: true,
            },
          ],
        },
      ],
      now,
    )
    expect(prompt).toContain('temporal:')
    expect(prompt).toContain('EXPIRED')
    expect(prompt).toContain('go inline skating today')
  })
})

describe('compose prompt helpers', () => {
  it('marks community themes as non-evidence', () => {
    const block = formatCommunityThemesForPrompt([
      { communityId: 'c1', level: 1, summaryText: 'Work and travel themes.' },
    ])
    expect(block).toContain('[theme-1]')
    expect(block).toContain('NOT evidence')
  })

  it('formats grounding profile with profile citation hint', () => {
    const block = formatGroundingProfileForCompose(
      'User grounding profile (supplementary background about the user — not a substitute for retrieved thoughts):\n- work: SPACE Hamburg',
    )
    expect(block).toContain('SPACE Hamburg')
    expect(block).toContain(GROUNDING_PROFILE_CITATION_ID)
  })

  it('insufficientMemoryAnswer uses Not in memory contract', () => {
    expect(insufficientMemoryAnswer('what am I about?')).toContain('Answer: Not in memory.')
  })
})

describe('formatTextFilesForPrompt', () => {
  it('returns empty string when no files', () => {
    expect(formatTextFilesForPrompt([])).toBe('')
  })

  it('formats file id, title, and preview', () => {
    const block = formatTextFilesForPrompt([
      {
        id: 'f1',
        title: 'Carbonara',
        preview: 'Boil pasta…',
        lexicalScore: 0.3,
        updatedAt: '2026-06-01T12:00:00.000Z',
      },
    ])
    expect(block).toContain('file=f1')
    expect(block).toContain('Boil pasta')
  })
})

describe('composeAnswer', () => {
  const localIntent = {
    scope: 'local' as const,
    temporal: false,
    kind: 'none' as const,
    entityHints: [] as string[],
    timeWindow: null,
    durationUnit: null,
    comparativeOrdering: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    dbWhereMock.mockResolvedValue([])
    classifyQueryIntentMock.mockResolvedValue(localIntent)
    loadGroundingProfileForEnrichmentMock.mockResolvedValue(null)
    fetchTemporalEventSeedsMock.mockResolvedValue({ seeds: [], candidatesByHint: [] })
    resolveTemporalHintBindingsMock.mockResolvedValue([])
    fetchRelevantCommunitySummariesMock.mockResolvedValue([])
    searchThoughtsMock.mockResolvedValue(sampleRetrieval)
    searchTextFilesMock.mockResolvedValue([])
    findTemporalSchedulingConflictsMock.mockResolvedValue([])
    createThoughtEmbeddingMock.mockResolvedValue(new Array(1536).fill(0.1))
    createThoughtEmbeddingsMock.mockImplementation(async (_userId: string, texts: string[]) =>
      texts.map(() => new Array(1536).fill(0.1)),
    )
    lexicalSearchMock.mockResolvedValue([])
    graphOnlySearchByQueryMock.mockResolvedValue([])
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: Marcus suggested rice flour.\nEvidence:\n- Rice flour suggestion [id=t_001]\n- Tartine loaves [id=t_002]\nUnknown:\n- none',
      ),
    )
  })

  it('uses unified retrieval for global-scope queries (no searchGlobal map-reduce)', async () => {
    classifyQueryIntentMock.mockResolvedValue({ ...localIntent, scope: 'global' })
    searchThoughtsMock.mockImplementation(
      async (params: {
        extrasOut?: {
          communityThemes: Array<{ communityId: string; level: number; summaryText: string }>
          temporalSeeds: unknown[]
        }
      }) => {
        if (params.extrasOut) {
          params.extrasOut.communityThemes = [
            { communityId: 'c1', level: 1, summaryText: 'Family and creativity themes.' },
          ]
          params.extrasOut.temporalSeeds = []
        }
        return sampleRetrieval
      },
    )
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: You value family and creative work.\nEvidence:\n- Family matters [t_001]\nUnknown:\n- none',
      ),
    )

    const result = await composeAnswer({ userId: 'u1', question: 'was weißt du über mich?' })

    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        query: 'was weißt du über mich?',
        topK: 16,
        extrasOut: expect.any(Object),
      }),
    )
    expect(createThoughtEmbeddingMock).toHaveBeenCalled()
    expect(llmChatCompletionMock).toHaveBeenCalled()
    expect(result.retrievalPath).toBe('global')
    const userMessage = llmChatCompletionMock.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user',
    )
    expect(userMessage.content).toContain('[theme-1]')
    expect(userMessage.content).toContain('NOT evidence')
  })

  it('uses unified retrieval for "what am I about?" with higher topK', async () => {
    classifyQueryIntentMock.mockResolvedValue({ ...localIntent, scope: 'global' })

    const result = await composeAnswer({ userId: 'u1', question: 'what am I about?' })

    expect(searchThoughtsMock).toHaveBeenCalledWith(expect.objectContaining({ topK: 16 }))
    expect(result.retrievalPath).toBe('global')
  })

  it('includes grounding profile in compose prompt when retrieved thoughts exist', async () => {
    loadGroundingProfileForEnrichmentMock.mockResolvedValue({
      narrativeSummary: '',
      facets: { work: 'Codes at SPACE Hamburg every day' },
    })
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        `Answer: You work at SPACE Hamburg.\nEvidence:\n- Daily work at SPACE Hamburg [id=t_001]\nUnknown:\n- none`,
      ),
    )

    const result = await composeAnswer({ userId: 'u1', question: 'where do I work?' })

    const userMessage = llmChatCompletionMock.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user',
    )
    expect(userMessage.content).toContain('SPACE Hamburg')
    expect(result.citations).not.toContain(GROUNDING_PROFILE_CITATION_ID)
  })

  it('does not answer from grounding profile alone when nothing is retrieved', async () => {
    loadGroundingProfileForEnrichmentMock.mockResolvedValue({
      narrativeSummary: '',
      facets: { work: 'Codes at SPACE Hamburg every day' },
    })
    searchThoughtsMock.mockResolvedValue([])
    searchTextFilesMock.mockResolvedValue([])

    const result = await composeAnswer({ userId: 'u1', question: 'where do I work?' })

    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(result.answer).toContain('Not in memory.')
    expect(result.citations).toEqual([])
  })

  it('returns honest insufficient-memory answer without LLM when nothing is retrieved', async () => {
    searchThoughtsMock.mockResolvedValue([])
    searchTextFilesMock.mockResolvedValue([])

    const result = await composeAnswer({ userId: 'u1', question: 'what am I about?' })

    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(result.answer).toContain('Not in memory.')
    expect(result.citations).toEqual([])
  })

  it('rejects empty questions before doing any work', async () => {
    await expect(composeAnswer({ userId: 'u1', question: '   ' })).rejects.toThrow(
      'composeAnswer: question must be non-empty',
    )
    expect(searchThoughtsMock).not.toHaveBeenCalled()
    expect(searchTextFilesMock).not.toHaveBeenCalled()
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
  })

  it('includes lexical text file hits in the compose prompt', async () => {
    searchTextFilesMock.mockResolvedValue([
      {
        id: 'f1',
        title: 'Carbonara recipe',
        preview: '200g spaghetti, guanciale, eggs…',
        lexicalScore: 0.42,
        updatedAt: '2026-01-01T00:00:00.000Z',
        author: 'user',
        authorLabel: null,
        authorKeyId: null,
      },
    ])
    await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
    expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
      query: 'carbonara recipe',
      topK: 5,
    })
    const userMessage = llmChatCompletionMock.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user',
    )
    expect(userMessage.content).toContain('file=f1')
    expect(userMessage.content).toContain('200g spaghetti')
  })

  it('emits onProgress for embedding, searching, and composing', async () => {
    const phases: string[] = []
    await composeAnswer({
      userId: 'u1',
      question: 'what about rice flour?',
      onProgress: (phase) => {
        phases.push(phase)
      },
    })
    expect(phases).toEqual(['embedding', 'searching', 'composing'])
  })

  it('returns an answer with citations from the retrieved set', async () => {
    const result = await composeAnswer({ userId: 'u1', question: 'what about rice flour?' })
    expect(result.answer).toContain('[id=t_001]')
    expect(result.citations).toEqual(expect.arrayContaining(['t_001', 't_002']))
    expect(result.retrieved).toHaveLength(2)
    expect(result.retrieved[0].id).toBe('t_001')
    expect(result.conflicts).toBeDefined()
  })

  it('runs unified retrieval once for who-is questions', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 'b',
        normalizedText: 'clemi ist clemens',
        category: 'reference',
        score: 1,
        vectorScore: 1,
        graphScore: 0,
        metadata: {},
        createdAt: FIXED_DATE,
        memoryType: null,
      },
    ])
    llmChatCompletionMock.mockResolvedValueOnce(
      chatResponse(
        'Answer: Clemi is Clemens.\nEvidence:\n- Clemi is Clemens [b]\n\nUnknown:\n- none',
      ),
    )
    await composeAnswer({ userId: 'u1', question: 'Wer ist Clemi?' })
    expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(searchThoughtsMock).toHaveBeenCalledTimes(1)
    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Wer ist Clemi?', queryEmbedding: expect.any(Array) }),
    )
  })

  it('excludes low-score retrieval hits from compose prompt', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: '38b31459-ba6a-4e59-ac4e-1bf3039d142b',
        normalizedText: 'annie ist meine schwester',
        category: 'reference',
        score: 0.03,
        vectorScore: 0.02,
        graphScore: 0.01,
        metadata: { graphProvenance: 'entity:schwester' },
        createdAt: FIXED_DATE,
      },
    ])
    const result = await composeAnswer({ userId: 'u1', question: 'Wer ist Clemi?' })
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(result.answer).toContain('Not in memory.')
  })

  it('forwards topK, weights, and trimmed question to searchThoughts', async () => {
    await composeAnswer({
      userId: 'u1',
      question: '   what about graph weights?  ',
      topK: 5,
      weights: { vector: 0.4, graph: 0.6 },
    })
    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        query: 'what about graph weights?',
        topK: 5,
        weights: { vector: 0.4, graph: 0.6 },
        queryEmbedding: expect.any(Array),
      }),
    )
    expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'what about graph weights?')
  })

  it('uses default topK of 8 when not provided', async () => {
    await composeAnswer({ userId: 'u1', question: 'x' })
    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 8, weights: CONTEXT_WEIGHTS.default }),
    )
  })

  it('uses retrievalQuery as the single unified search when provided', async () => {
    searchThoughtsMock.mockResolvedValue(sampleRetrieval)
    await composeAnswer({
      userId: 'u1',
      question: 'scheduling conflict?',
      retrievalQuery: 'March schedule conflicts team',
    })
    expect(searchThoughtsMock).toHaveBeenCalledTimes(1)
    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'March schedule conflicts team' }),
    )
  })

  it('passes a system + user message pair with temperature 0', async () => {
    await composeAnswer({ userId: 'u1', question: 'why rice flour' })
    const args = llmChatCompletionMock.mock.calls[0][0] as {
      userId: string
      messages: Array<{ role: string; content: string }>
      temperature: number
    }
    expect(args.userId).toBe('u1')
    expect(args.temperature).toBe(0)
    expect(args.messages).toHaveLength(2)
    expect(args.messages[0].role).toBe('system')
    expect(args.messages[1].role).toBe('user')
    expect(args.messages[1].content).toContain('why rice flour')
    expect(args.messages[1].content).toContain('id=t_001')
    expect(args.messages[1].content).toContain('id=t_002')
  })

  it('communicates the no-thoughts case without calling compose LLM', async () => {
    searchThoughtsMock.mockResolvedValueOnce([])
    const result = await composeAnswer({ userId: 'u1', question: 'totally novel question' })
    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(result.retrieved).toEqual([])
    expect(result.citations).toEqual([])
    expect(result.answer).toContain('Not in memory.')
  })

  it('throws when the answer cites ids outside the retrieved set', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: Some claim.\nEvidence:\n- Claim [id=t_001]\n- Hallucinated [id=t_999]\nUnknown:\n- none',
      ),
    )
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'cites thought ids not in retrieved context',
    )
  })

  it('throws when the answer cites list position numbers instead of thought ids', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: Jonas needs silence.\nEvidence:\n- Needs silence [6]\nUnknown:\n- none',
      ),
    )
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'cites thought ids not in retrieved context: 6',
    )
  })

  it('strips disallowed computed citations instead of failing the answer', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: 4 days between events [id=t_001].\nEvidence:\n- Event A [id=t_001]\n- Event B [id=t_002]\n- Difference is 4 days [id=computed]\nUnknown:\n- none',
      ),
    )
    const result = await composeAnswer({ userId: 'u1', question: 'how many days between?' })
    expect(result.answer).not.toContain('computed')
    expect(result.answer).toContain('[id=t_001]')
  })

  it('returns deterministic duration answer without calling compose LLM', async () => {
    classifyQueryIntentMock.mockResolvedValue({
      scope: 'local',
      temporal: true,
      kind: 'duration',
      entityHints: ['workshop', 'team meeting'],
      timeWindow: null,
      durationUnit: 'days',
      comparativeOrdering: false,
    })
    fetchTemporalEventSeedsMock.mockResolvedValue({
      seeds: [
        {
          eventId: 'ev-1',
          thoughtId: 't_001',
          semanticSummary: 'Workshop on Effective Communication in the Workplace',
          startAt: new Date('2023-01-10T00:00:00.000Z'),
          activePeriod: '[2023-01-10T00:00:00.000Z,2023-01-11T00:00:00.000Z)',
          kind: 'milestone',
        },
        {
          eventId: 'ev-2',
          thoughtId: 't_002',
          semanticSummary: 'Team meeting scheduled',
          startAt: new Date('2023-01-17T00:00:00.000Z'),
          activePeriod: '[2023-01-17T00:00:00.000Z,2023-01-18T00:00:00.000Z)',
          kind: 'milestone',
        },
      ],
      candidatesByHint: [[], []],
    })
    resolveTemporalHintBindingsMock.mockResolvedValue([
      { hint: 'workshop', eventId: 'ev-1', thoughtId: 't_001' },
      { hint: 'team meeting', eventId: 'ev-2', thoughtId: 't_002' },
    ])

    const result = await composeAnswer({
      userId: 'u1',
      question: 'How many days between the workshop and the team meeting?',
    })

    expect(llmChatCompletionMock).not.toHaveBeenCalled()
    expect(result.answer).toContain('7 calendar days')
    expect(result.citations).toEqual(expect.arrayContaining(['t_001', 't_002', 'computed']))
  })

  it('passes question and kind to resolveTemporalHintBindings', async () => {
    classifyQueryIntentMock.mockResolvedValue({
      scope: 'local',
      temporal: true,
      kind: 'duration',
      entityHints: ['Walk for Hunger', 'Coastal Cleanup'],
      timeWindow: null,
      durationUnit: 'days',
      comparativeOrdering: false,
    })
    fetchTemporalEventSeedsMock.mockResolvedValue({
      seeds: [
        {
          eventId: 'ev-walk',
          thoughtId: 't_walk',
          semanticSummary: 'Walk for Hunger charity 5K',
          startAt: new Date('2023-02-21T00:00:00.000Z'),
          activePeriod: '[2023-02-21T00:00:00.000Z,2023-02-22T00:00:00.000Z)',
          kind: 'milestone',
        },
        {
          eventId: 'ev-coastal',
          thoughtId: 't_coastal',
          semanticSummary: 'Coastal Cleanup charity event',
          startAt: new Date('2023-03-07T00:00:00.000Z'),
          activePeriod: '[2023-03-07T00:00:00.000Z,2023-03-08T00:00:00.000Z)',
          kind: 'milestone',
        },
      ],
      candidatesByHint: [
        [
          {
            eventId: 'ev-walk',
            thoughtId: 't_walk',
            semanticSummary: 'Walk for Hunger charity 5K',
            startAt: '2023-02-21T00:00:00.000Z',
            kind: 'milestone',
          },
        ],
        [
          {
            eventId: 'ev-coastal',
            thoughtId: 't_coastal',
            semanticSummary: 'Coastal Cleanup charity event',
            startAt: '2023-03-07T00:00:00.000Z',
            kind: 'milestone',
          },
        ],
      ],
    })
    resolveTemporalHintBindingsMock.mockResolvedValue([
      { hint: 'Walk for Hunger', eventId: 'ev-walk', thoughtId: 't_walk' },
      { hint: 'Coastal Cleanup', eventId: 'ev-coastal', thoughtId: 't_coastal' },
    ])

    const question =
      "How many days had passed between the 'Walk for Hunger' event and the 'Coastal Cleanup' event?"
    await composeAnswer({ userId: 'u1', question })

    expect(resolveTemporalHintBindingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        question,
        kind: 'duration',
        hints: ['Walk for Hunger', 'Coastal Cleanup'],
        candidatesByHint: expect.any(Array),
      }),
    )
  })

  it('does not bypass compose LLM for misclassified ordering on fact-lookup questions', async () => {
    classifyQueryIntentMock.mockResolvedValue({
      scope: 'local',
      temporal: true,
      kind: 'ordering',
      entityHints: ['first service', 'GPS system'],
      timeWindow: null,
      durationUnit: null,
      comparativeOrdering: false,
    })
    fetchTemporalEventSeedsMock.mockResolvedValue({
      seeds: [
        {
          eventId: 'ev-1',
          thoughtId: 't_svc',
          semanticSummary: 'Car first service on March 15th',
          startAt: new Date('2023-03-15T00:00:00.000Z'),
          activePeriod: '[2023-03-15T00:00:00.000Z,2023-03-16T00:00:00.000Z)',
          kind: 'milestone',
        },
        {
          eventId: 'ev-2',
          thoughtId: 't_gps',
          semanticSummary: 'GPS system issue on March 22nd',
          startAt: new Date('2023-03-22T00:00:00.000Z'),
          activePeriod: '[2023-03-22T00:00:00.000Z,2023-03-23T00:00:00.000Z)',
          kind: 'milestone',
        },
      ],
      candidatesByHint: [[], []],
    })
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: GPS system not functioning correctly.\nEvidence:\n- GPS issue [id=t_gps]\nUnknown:\n- none',
      ),
    )

    await composeAnswer({
      userId: 'u1',
      question: 'What was the first issue I had with my new car after its first service?',
    })

    expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
  })

  it('does not number thoughts with # prefixes in the compose prompt', async () => {
    await composeAnswer({ userId: 'u1', question: 'why rice flour' })
    const userMessage = (
      llmChatCompletionMock.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>
      }
    ).messages[1].content
    expect(userMessage).not.toMatch(/^#\d+\s/m)
    expect(userMessage).not.toMatch(/\n#\d+\s/m)
    expect(userMessage).toContain('id=t_001')
  })

  it('embeds the retrieval query once for compose', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 'b',
        normalizedText: 'clemi ist clemens',
        category: 'reference',
        score: 1,
        vectorScore: 1,
        graphScore: 0,
        metadata: {},
        createdAt: FIXED_DATE,
        memoryType: null,
      },
    ])
    llmChatCompletionMock.mockResolvedValueOnce(
      chatResponse(
        'Answer: Clemi is Clemens.\nEvidence:\n- Clemi is Clemens [b]\n\nUnknown:\n- none',
      ),
    )
    await composeAnswer({ userId: 'u1', question: 'Wer ist Clemi?' })
    expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'Wer ist Clemi?')
    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Wer ist Clemi?', queryEmbedding: expect.any(Array) }),
    )
  })

  it('throws a clear error when the LLM response shape is unexpected', async () => {
    llmChatCompletionMock.mockResolvedValueOnce(null)
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'LLM chat response is not an object',
    )
  })

  it('throws when the response has no choices', async () => {
    llmChatCompletionMock.mockResolvedValueOnce({ choices: [] })
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'LLM chat response has no choices',
    )
  })

  it('throws when a choice has no message', async () => {
    llmChatCompletionMock.mockResolvedValueOnce({ choices: [{}] })
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'LLM chat response choice has no message',
    )
  })

  it('throws when message content is missing or empty', async () => {
    llmChatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { content: '   ' } }] })
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'LLM chat response content is empty',
    )
    llmChatCompletionMock.mockResolvedValueOnce({ choices: [{ message: { content: 123 } }] })
    await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
      'LLM chat response content is empty',
    )
  })

  it('surfaces graphProvenance from retrieval metadata into the prompt and context items', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 't_003',
        normalizedText: 'Connected via Marcus.',
        category: 'thought',
        score: 0.5,
        vectorScore: 0.4,
        graphScore: 0.1,
        metadata: { graphProvenance: 'entity:Marcus' },
        createdAt: FIXED_DATE,
        memoryType: null,
      },
    ])
    llmChatCompletionMock.mockResolvedValueOnce(
      chatResponse('Answer: Connected via Marcus.\nEvidence:\n- Link [t_003]\n\nUnknown:\n- none'),
    )
    const result = await composeAnswer({ userId: 'u1', question: 'how is this connected?' })
    expect(result.retrieved[0].graphProvenance).toBe('entity:Marcus')
    const userMessage = (
      llmChatCompletionMock.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>
      }
    ).messages[1].content
    expect(userMessage).toContain('Graph: entity:Marcus')
  })

  it('includes expired temporal annotations in the compose prompt', async () => {
    dbWhereMock.mockResolvedValueOnce([
      {
        thoughtId: 't_skate',
        kind: 'reminder',
        semanticSummary: 'go inline skating today',
        activePeriod: '[2026-05-28T00:00:00.000Z,2026-05-29T00:00:00.000Z)',
      },
    ])
    searchThoughtsMock.mockResolvedValue([
      {
        id: 't_skate',
        normalizedText: 'I want to go inline skating today.',
        category: 'task',
        score: 0.9,
        vectorScore: 0.9,
        graphScore: 0,
        metadata: {},
        createdAt: new Date('2026-05-28T00:00:00.000Z'),
        memoryType: null,
      },
    ])
    llmChatCompletionMock.mockResolvedValueOnce(
      chatResponse(
        'Answer: Not in memory for today.\nEvidence:\n- As of 2026-05-28 you wanted to go inline skating [t_skate]\n\nUnknown:\n- current skating plans',
      ),
    )

    const result = await composeAnswer({
      userId: 'u1',
      question: 'Do I want to go inline skating today?',
    })

    expect(result.retrieved[0]?.temporalStatus).toBe('expired')
    const messages = (
      llmChatCompletionMock.mock.calls[0][0] as {
        messages: Array<{ role: string; content: string }>
      }
    ).messages
    expect(messages[0].content).toContain('EXPIRED')
    expect(messages[1].content).toContain('temporal:')
    expect(messages[1].content).toContain('EXPIRED')
  })

  it('includes temporal graph conflicts in the prompt when detected', async () => {
    findTemporalSchedulingConflictsMock.mockResolvedValueOnce([
      {
        personEntityId: 'ent-tom',
        personLabel: 'Tom',
        events: [],
        mandatoryThoughtIds: ['t_mandatory'],
        thoughtIds: ['t_tom', 't_berlin', 't_mandatory'],
        description: 'Tom has overlapping events in Lisbon and Berlin',
      },
    ])
    await composeAnswer({ userId: 'u1', question: 'Is there a scheduling conflict?' })
    expect(findTemporalSchedulingConflictsMock).toHaveBeenCalled()
    const userMessage = (
      llmChatCompletionMock.mock.calls[0][0] as { messages: Array<{ content: string }> }
    ).messages[1].content
    expect(userMessage).toContain('Temporal scheduling conflicts')
  })
})

describe('detectContradictions', () => {
  const now = new Date('2026-06-04T12:00:00.000Z')
  const base = (id: string, text: string): RetrievalContextItem => ({
    id,
    normalizedText: text,
    category: 'feeling',
    score: 1,
    vectorScore: 1,
    graphScore: 0,
    createdAt: now,
    isStale: false,
    ...noTemporal,
  })

  it('returns empty — regex contradiction detection removed', () => {
    const conflicts = detectContradictions([
      base(
        'a',
        'Remote work is terrible for me. I lose all discipline and end up doing nothing. Need an office.',
      ),
      base(
        'b',
        'Working from home is actually great. I am more productive, calmer, and the commute savings are real.',
      ),
    ])
    expect(conflicts).toEqual([])
  })
})
