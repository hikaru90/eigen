import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval'
import { withEvalRelevanceFloor } from '$lib/server/retrieval/relevance-floor'
import { FAKE_SECRETS, guardWouldTrip, leaks } from '$lib/test/secret-fixtures'
import {
  buildComposeSystemPrompt,
  composeAnswer,
  extractProfileDetailsBlock,
  extractQuestionSubjectName,
  extractRetrievalHints,
  factHitToContextItem,
  findInvalidCitationIds,
  findInvalidProfileCitationIds,
  formatComposedAnswerForUser,
  formatCommunityThemesForPrompt,
  formatFactsForPrompt,
  formatGroundingProfileForCompose,
  formatThoughtsForPrompt,
  formatTextFilesForPrompt,
  GROUNDING_PROFILE_CITATION_ID,
  insufficientMemoryAnswer,
  narrowComposeContextToQuestionFocus,
  prioritizePersonNamedThoughts,
  type RetrievalContextItem,
} from './compose-answer'
import { withComposeObserver } from './compose-observer'

const {
  searchThoughtsMock,
  searchTextFilesMock,
  classifyQueryIntentMock,
  fetchTemporalEventSeedsMock,
  resolveTemporalHintBindingsMock,
  fetchRelevantCommunitySummariesMock,
  loadGroundingProfileForEnrichmentMock,
  llmChatCompletionMock,
  createThoughtEmbeddingMock,
  createThoughtEmbeddingsMock,
  lexicalSearchMock,
  graphOnlySearchByQueryMock,
  dbWhereMock,
  loadTemporalContextMock,
  expandPersonalizationQueriesMock,
  searchUserFactsMock,
  substituteSecureReferencesMock,
  resolveSecureReferencesMock,
  runEnforcedPerItemDecisionsMock,
} = vi.hoisted(() => ({
  searchThoughtsMock: vi.fn(),
  searchTextFilesMock: vi.fn(),
  classifyQueryIntentMock: vi.fn(),
  fetchTemporalEventSeedsMock: vi.fn(),
  resolveTemporalHintBindingsMock: vi.fn(),
  fetchRelevantCommunitySummariesMock: vi.fn(),
  loadGroundingProfileForEnrichmentMock: vi.fn(),
  llmChatCompletionMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  createThoughtEmbeddingsMock: vi.fn(),
  lexicalSearchMock: vi.fn(),
  graphOnlySearchByQueryMock: vi.fn(),
  dbWhereMock: vi.fn(),
  loadTemporalContextMock: vi.fn(),
  expandPersonalizationQueriesMock: vi.fn(),
  searchUserFactsMock: vi.fn(),
  substituteSecureReferencesMock: vi.fn(),
  resolveSecureReferencesMock: vi.fn(),
  runEnforcedPerItemDecisionsMock: vi.fn(),
}))

// What the answer sees is judged by Jev (evidence_relevance) through the plane: mocked at its
// boundary, so no spec reaches the Decisions API. Default verdict below: everything is relevant.
vi.mock('$lib/server/llm/decision-plane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/llm/decision-plane')>()
  return { ...actual, runEnforcedPerItemDecisions: runEnforcedPerItemDecisionsMock }
})

vi.mock('$lib/server/facts/search-user-facts', () => ({
  searchUserFacts: searchUserFactsMock,
}))

// composeAnswer never decrypts an identifier: the answer keeps the reference token, the server
// substitutes at the response boundary. These mocks exist to prove it is never called here.
vi.mock('$lib/server/facts/secure-values', () => ({
  substituteSecureReferences: substituteSecureReferencesMock,
  resolveSecureReferences: resolveSecureReferencesMock,
}))

vi.mock('$lib/server/retrieval/service', () => ({
  searchThoughts: searchThoughtsMock,
}))

vi.mock('$lib/server/text-files/service', () => ({
  searchTextFiles: searchTextFilesMock,
}))

vi.mock('$lib/server/retrieval/expand-personalization-queries', () => ({
  expandPersonalizationQueries: expandPersonalizationQueriesMock,
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

vi.mock('$lib/server/db', () => ({
  getDb: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: dbWhereMock,
      }),
    }),
  }),
}))

vi.mock('$lib/server/memory/temporal-context', () => ({
  loadTemporalContextByThoughtIds: loadTemporalContextMock,
}))

function chatResponse(content: string) {
  return { choices: [{ message: { content } }] }
}

type RelevanceVerdicts = Record<
  string,
  readonly ['relevant' | 'partly' | 'not', Record<string, number>]
>

/** Jev's relevance answers by candidate ref (t1.., n1.., f1..); unlisted candidates are relevant. */
function jevRelevance(verdicts: RelevanceVerdicts = {}) {
  runEnforcedPerItemDecisionsMock.mockImplementation(
    async (input: { items: Array<{ ref: string }> }) =>
      new Map(
        input.items.map((item) => {
          const [choice, probabilities] = verdicts[item.ref] ?? [
            'relevant',
            { relevant: 0.9, partly: 0.07, not: 0.03 },
          ]
          return [
            item.ref,
            {
              choice,
              probability: probabilities[choice]!,
              alternatives: Object.fromEntries(
                Object.entries(probabilities).filter(([k]) => k !== choice),
              ),
            },
          ]
        }),
      ),
  )
}

const relevanceCalls = () =>
  runEnforcedPerItemDecisionsMock.mock.calls.map(
    (c) =>
      c[0] as {
        surface: string
        kind: string
        state: string
        items: Array<{ ref: string; instructions: string }>
      },
  )

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
    kind: 'thought',
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

function noteHit(patch: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    title: 'Conference trip',
    preview: 'Taking an early morning out on the waves',
    excerpt:
      'Before the keynote I am taking an early morning out on the waves.\n[…]\nThe keynote is on Friday.',
    matchedOrdinals: [3],
    score: 0.42,
    vectorScore: 0.42,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    author: 'user',
    authorLabel: null,
    authorKeyId: null,
    ...patch,
  }
}

const SECURE_ID = '11111111-1111-4111-8111-111111111111'
const PLATE_VALUE = 'B-XY 4711'

/** A `searchUserFacts` hit (user_fact row, decrypted statement). */
function factHit(patch: Record<string, unknown> = {}) {
  return {
    id: 'f_pool',
    subjectKind: 'user',
    subjectLabel: null,
    subjectEntityId: null,
    statement: 'The user swims at the local pool',
    kind: 'activity',
    inferred: false,
    confidence: 0.9,
    status: 'active',
    supersededBy: null,
    asOf: new Date('2026-03-02T09:00:00.000Z'),
    secureValueId: null,
    sourceThoughtIds: [],
    sourceTextFileIds: [],
    score: 0.61,
    vectorScore: 0.61,
    ...patch,
  }
}

const miaFact = () =>
  factHit({
    id: 'f_mia',
    subjectKind: 'person',
    subjectLabel: 'Mia (friend)',
    statement: 'Mia (friend) barely drinks water',
    kind: 'health',
    inferred: true,
    asOf: new Date('2026-03-05T09:00:00.000Z'),
    score: 0.55,
  })

const plateFact = () =>
  factHit({
    id: 'f_plate',
    statement: `The user's licence plate is [secure:${SECURE_ID}]`,
    kind: 'circumstance',
    secureValueId: SECURE_ID,
    score: 0.7,
  })

describe('factHitToContextItem', () => {
  it('a fact about the user: kind fact, its text names the subject, dated by its as-of time', () => {
    const item = factHitToContextItem(factHit() as never)
    expect(item).toMatchObject({
      id: 'f_pool',
      kind: 'fact',
      category: 'fact',
      normalizedText: 'Fact about the user: The user swims at the local pool',
      author: 'user',
      authorLabel: null,
      score: 0.61,
      vectorScore: 0.61,
      graphScore: 0,
      createdAt: new Date('2026-03-02T09:00:00.000Z'),
      isStale: false,
      temporalStatus: 'none',
      temporalEvents: [],
      fact: { subject: 'the user', subjectKind: 'user', factKind: 'activity', inferred: false },
    })
  })

  it('a fact about another person names that person, not the user', () => {
    const item = factHitToContextItem(miaFact() as never)
    expect(item.normalizedText).toBe('Fact about Mia (friend): Mia (friend) barely drinks water')
    expect(item.fact).toEqual({
      subject: 'Mia (friend)',
      subjectKind: 'person',
      factKind: 'health',
      inferred: true,
    })
  })

  it('an identifier fact keeps its reference token and carries no value or embedding', () => {
    const item = factHitToContextItem(plateFact() as never)
    expect(item.normalizedText).toBe(
      `Fact about the user: The user's licence plate is [secure:${SECURE_ID}]`,
    )
    expect(JSON.stringify(item)).not.toContain(PLATE_VALUE)
    expect(JSON.stringify(item).toLowerCase()).not.toContain('embedding')
  })
})

describe('formatFactsForPrompt', () => {
  it('returns an empty string when there are no facts', () => {
    expect(formatFactsForPrompt([])).toBe('')
  })

  it('lists each fact with its citable id, subject, statement, kind, as-of date and inferred marker', () => {
    const block = formatFactsForPrompt(
      [factHit(), miaFact()].map((h) => factHitToContextItem(h as never)),
    )
    expect(block).toContain('Known facts')
    expect(block).toContain(
      '[id=f_pool] Fact about the user: The user swims at the local pool (activity, as of 2026-03-02)',
    )
    expect(block).toContain(
      '[id=f_mia] Fact about Mia (friend): Mia (friend) barely drinks water (health, as of 2026-03-05, inferred)',
    )
  })

  it('shows an identifier fact by its reference token only', () => {
    const block = formatFactsForPrompt([factHitToContextItem(plateFact() as never)])
    expect(block).toContain(`[secure:${SECURE_ID}]`)
    expect(block).not.toContain(PLATE_VALUE)
  })
})

describe('formatTextFilesForPrompt', () => {
  it('returns empty string when no files', () => {
    expect(formatTextFilesForPrompt([])).toBe('')
  })

  it('formats a citable note id header with title and date, then the matched excerpt', () => {
    const block = formatTextFilesForPrompt([noteHit()])
    expect(block).toContain('[id=f1]')
    expect(block).toContain('Conference trip')
    expect(block).toContain('stored=2026-01-01')
    expect(block).toContain('taking an early morning out on the waves')
    expect(block).toContain('[…]')
    expect(block).not.toContain('no embedding')
  })

  it('falls back to a title placeholder for untitled notes', () => {
    expect(formatTextFilesForPrompt([noteHit({ title: '  ' })])).toContain('Untitled note')
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
    personalization: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    jevRelevance()
    dbWhereMock.mockResolvedValue([])
    loadTemporalContextMock.mockResolvedValue(new Map())
    classifyQueryIntentMock.mockResolvedValue(localIntent)
    loadGroundingProfileForEnrichmentMock.mockResolvedValue(null)
    fetchTemporalEventSeedsMock.mockResolvedValue({ seeds: [], candidatesByHint: [] })
    resolveTemporalHintBindingsMock.mockResolvedValue([])
    fetchRelevantCommunitySummariesMock.mockResolvedValue([])
    searchThoughtsMock.mockResolvedValue(sampleRetrieval)
    searchTextFilesMock.mockResolvedValue([])
    searchUserFactsMock.mockResolvedValue([])
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

  it('a credential typed into the question is never classified, embedded, searched, prompted or logged (secret hygiene)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const question = `is ${FAKE_SECRETS.githubClassic} still my deploy token?`

    await composeAnswer({
      userId: 'u1',
      question,
      retrievalQuery: `deploy ${FAKE_SECRETS.githubClassic}`,
    })

    const downstream = [
      classifyQueryIntentMock.mock.calls,
      createThoughtEmbeddingMock.mock.calls,
      createThoughtEmbeddingsMock.mock.calls,
      searchThoughtsMock.mock.calls.map(([arg]) => ({
        ...(arg as object),
        queryEmbedding: undefined,
      })),
      searchTextFilesMock.mock.calls.map(([, arg]) => ({
        ...(arg as object),
        queryEmbedding: undefined,
      })),
      llmChatCompletionMock.mock.calls,
      info.mock.calls,
    ]
    expect(leaks(JSON.stringify(downstream))).toBe(false)
    expect(guardWouldTrip(downstream)).toBe(false)
    info.mockRestore()
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

  it('returns context = every item given to the answer model, a superset of the cited retrieved', async () => {
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: Marcus suggested rice flour.\nEvidence:\n- Rice flour suggestion [id=t_001]\nUnknown:\n- none',
      ),
    )

    const result = await composeAnswer({ userId: 'u1', question: 'who suggested rice flour?' })

    expect(result.citations).toEqual(['t_001'])
    expect(result.retrieved.map((r) => r.id)).toEqual(['t_001'])
    const contextIds = result.context.map((c) => c.id)
    expect(contextIds).toEqual(expect.arrayContaining(['t_001', 't_002']))
    expect(contextIds.length).toBeGreaterThan(result.retrieved.length)
    for (const item of result.retrieved) {
      expect(contextIds).toContain(item.id)
    }
    // the same items the answer model saw
    const userMessage = llmChatCompletionMock.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user',
    )
    for (const id of contextIds) {
      expect(userMessage.content).toContain(id)
    }
  })

  it('returns an empty context when nothing was retrieved (insufficient-memory path)', async () => {
    searchThoughtsMock.mockResolvedValue([])
    searchTextFilesMock.mockResolvedValue([])

    const result = await composeAnswer({ userId: 'u1', question: 'where do I work?' })

    expect(result.retrieved).toEqual([])
    expect(result.context).toEqual([])
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

  it('searches notes with the already-computed query embedding and the thought relevance floor', async () => {
    await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
    expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
      query: 'carbonara recipe',
      topK: 5,
      queryEmbedding: new Array(1536).fill(0.1),
      minScore: 0.22,
      onBelowFloor: expect.any(Function),
    })
    expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1)
  })

  describe('personalization expansion (S3)', () => {
    const advice = 'What should I eat before my morning run?'
    const subQueries = ['foods the user avoids', 'health conditions affecting energy']

    it("fact questions take today's path: no expansion call, no extra embedding, one search each", async () => {
      const result = await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })

      expect(expandPersonalizationQueriesMock).not.toHaveBeenCalled()
      expect(createThoughtEmbeddingsMock).not.toHaveBeenCalled()
      expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1)
      expect(searchThoughtsMock).toHaveBeenCalledTimes(1)
      expect(searchThoughtsMock.mock.calls[0]![0]).not.toHaveProperty('expansions')
      expect(searchTextFilesMock).toHaveBeenCalledTimes(1)
      // the only LLM call from compose itself is the answer
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
      expect(result.expansionQueries).toBeUndefined()
    })

    it('expands only when personalization is true, with the question text as the only input', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, personalization: true })
      expandPersonalizationQueriesMock.mockResolvedValue(subQueries)

      const result = await composeAnswer({
        userId: 'u1',
        question: advice,
        retrievalQuery: 'unrelated probe text',
      })

      expect(expandPersonalizationQueriesMock).toHaveBeenCalledTimes(1)
      expect(expandPersonalizationQueriesMock).toHaveBeenCalledWith({
        userId: 'u1',
        question: advice,
      })
      expect(result.expansionQueries).toEqual(subQueries)
    })

    it('embeds the sub-queries and hands thoughts one query-embedding pair per sub-query', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, personalization: true })
      expandPersonalizationQueriesMock.mockResolvedValue(subQueries)

      await composeAnswer({ userId: 'u1', question: advice })

      expect(createThoughtEmbeddingsMock).toHaveBeenCalledWith('u1', subQueries)
      expect(searchThoughtsMock).toHaveBeenCalledTimes(1)
      expect(searchThoughtsMock.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          query: advice,
          expansions: subQueries.map((query) => ({
            query,
            embedding: new Array(1536).fill(0.1),
          })),
        }),
      )
    })

    it('searches notes for the question and every sub-query and merges by reciprocal rank within the notes budget', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, personalization: true })
      expandPersonalizationQueriesMock.mockResolvedValue(subQueries)
      const byQuery: Record<string, ReturnType<typeof noteHit>[]> = {
        [advice]: [noteHit({ id: 'n1' }), noteHit({ id: 'n2' })],
        [subQueries[0]!]: [noteHit({ id: 'n3' }), noteHit({ id: 'n2' })],
        [subQueries[1]!]: [noteHit({ id: 'n3' }), noteHit({ id: 'n4' })],
      }
      searchTextFilesMock.mockImplementation(
        async (_u: string, arg: { query: string }) => byQuery[arg.query],
      )

      const result = await composeAnswer({ userId: 'u1', question: advice })

      expect(searchTextFilesMock).toHaveBeenCalledTimes(3)
      expect(
        searchTextFilesMock.mock.calls.map(([, arg]) => (arg as { query: string }).query),
      ).toEqual([advice, ...subQueries])
      const noteIds = result.context.filter((c) => c.category === 'note').map((c) => c.id)
      expect(noteIds).toEqual(['n3', 'n2', 'n1', 'n4'])
    })

    it('never exceeds the notes budget when sub-queries add many notes', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, personalization: true })
      expandPersonalizationQueriesMock.mockResolvedValue(subQueries)
      let n = 0
      searchTextFilesMock.mockImplementation(async () =>
        Array.from({ length: 5 }, () => noteHit({ id: `n${n++}` })),
      )

      const result = await composeAnswer({ userId: 'u1', question: advice })

      expect(result.context.filter((c) => c.category === 'note')).toHaveLength(5)
    })

    it('fails loud when expansion fails (no silent fall back to the plain question)', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, personalization: true })
      expandPersonalizationQueriesMock.mockRejectedValue(new Error('expansion failed'))

      await expect(composeAnswer({ userId: 'u1', question: advice })).rejects.toThrow(
        'expansion failed',
      )
      expect(searchThoughtsMock).not.toHaveBeenCalled()
      expect(searchTextFilesMock).not.toHaveBeenCalled()
    })
  })

  describe('user facts (docs/planning/user-facts-layer.md, F2)', () => {
    const advice = 'What should I eat before my morning run?'
    const subQueries = ['foods the user avoids', 'health conditions affecting energy']
    const userMessage = () =>
      llmChatCompletionMock.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === 'user',
      ).content as string
    const systemMessage = () =>
      llmChatCompletionMock.mock.calls[0][0].messages.find(
        (m: { role: string }) => m.role === 'system',
      ).content as string

    it('an advice question searches the facts for the question and every sub-query and puts them in the context and the prompt', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, personalization: true })
      expandPersonalizationQueriesMock.mockResolvedValue(subQueries)
      searchUserFactsMock.mockResolvedValue([factHit()])
      llmChatCompletionMock.mockResolvedValue(
        chatResponse(
          'Answer: A light meal after swimming.\nEvidence:\n- Swims at the local pool [id=f_pool]\nUnknown:\n- none',
        ),
      )

      const result = await composeAnswer({ userId: 'u1', question: advice })

      expect(searchUserFactsMock).toHaveBeenCalledTimes(3)
      expect(
        searchUserFactsMock.mock.calls.map(([, arg]) => (arg as { query: string }).query),
      ).toEqual([advice, ...subQueries])
      const factItem = result.context.find((c) => c.id === 'f_pool')
      expect(factItem).toMatchObject({
        kind: 'fact',
        normalizedText: 'Fact about the user: The user swims at the local pool',
      })
      expect(userMessage()).toContain('Known facts')
      expect(userMessage()).toContain('[id=f_pool]')
      expect(result.citations).toEqual(['f_pool'])
      expect(result.retrieved.map((r) => r.id)).toEqual(['f_pool'])
    })

    it('fact items come after thoughts and notes; thoughts keep their kind', async () => {
      searchTextFilesMock.mockResolvedValue([noteHit()])
      searchUserFactsMock.mockResolvedValue([factHit(), miaFact()])
      const result = await composeAnswer({ userId: 'u1', question: 'coastal activities?' })
      expect(result.context.map((c) => `${c.kind}:${c.id}`)).toEqual([
        'thought:t_001',
        'thought:t_002',
        'note:f1',
        'fact:f_pool',
        'fact:f_mia',
      ])
    })

    it("a fact about another person is rendered with its subject and is not the user's", async () => {
      searchUserFactsMock.mockResolvedValue([miaFact()])
      await composeAnswer({ userId: 'u1', question: 'how much water should I drink?' })
      expect(userMessage()).toContain(
        '[id=f_mia] Fact about Mia (friend): Mia (friend) barely drinks water (health, as of 2026-03-05, inferred)',
      )
      expect(userMessage()).not.toContain('Fact about the user: Mia')
    })

    it('an identifier fact shows only its reference token in the prompt, the context and the logs', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      searchUserFactsMock.mockResolvedValue([plateFact()])

      const result = await composeAnswer({ userId: 'u1', question: "what's my licence plate?" })

      const token = `[secure:${SECURE_ID}]`
      expect(userMessage()).toContain(token)
      expect(result.context.find((c) => c.id === 'f_plate')!.normalizedText).toContain(token)
      for (const payload of [
        llmChatCompletionMock.mock.calls,
        result,
        info.mock.calls,
        log.mock.calls,
      ]) {
        expect(JSON.stringify(payload)).not.toContain(PLATE_VALUE)
      }
      // the value is never even looked up here: substitution is the response boundary's job
      expect(substituteSecureReferencesMock).not.toHaveBeenCalled()
      expect(resolveSecureReferencesMock).not.toHaveBeenCalled()
      info.mockRestore()
      log.mockRestore()
    })

    it('"what\'s my licence plate?" is answered with the reference token, substituted only after composeAnswer', async () => {
      searchUserFactsMock.mockResolvedValue([plateFact()])
      llmChatCompletionMock.mockResolvedValue(
        chatResponse(
          `Answer: Your licence plate is [secure:${SECURE_ID}].\nEvidence:\n- Licence plate on file [id=f_plate]\nUnknown:\n- none`,
        ),
      )
      const result = await composeAnswer({ userId: 'u1', question: "what's my licence plate?" })
      expect(result.answer).toContain(`[secure:${SECURE_ID}]`)
      expect(result.answer).not.toContain(PLATE_VALUE)
      expect(result.citations).toEqual(['f_plate'])
    })

    it('facts alone are composable evidence', async () => {
      searchThoughtsMock.mockResolvedValue([])
      searchUserFactsMock.mockResolvedValue([factHit()])
      llmChatCompletionMock.mockResolvedValue(
        chatResponse('Answer: Swimming.\nEvidence:\n- Pool [id=f_pool]\nUnknown:\n- none'),
      )
      const result = await composeAnswer({ userId: 'u1', question: 'what sport do I do?' })
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
      expect(result.citations).toEqual(['f_pool'])
    })

    it('citing a fact id the answer was not given still throws', async () => {
      searchUserFactsMock.mockResolvedValue([factHit()])
      llmChatCompletionMock.mockResolvedValue(
        chatResponse('Answer: x.\nEvidence:\n- y [id=f_unknown]\nUnknown:\n- none'),
      )
      await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(/f_unknown/)
    })

    it('searches a candidate pool of 24 facts for every question; the answer sees at most 8 of them, however corpus-wide the question', async () => {
      await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
      expect(searchUserFactsMock.mock.calls[0]![1].topK).toBe(24)

      searchUserFactsMock.mockClear()
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, scope: 'global' })
      await composeAnswer({ userId: 'u1', question: 'what do you know about me?' })
      expect(searchUserFactsMock.mock.calls[0]![1].topK).toBe(24)

      const many = Array.from({ length: 24 }, (_, i) => factHit({ id: `f_${i}` }))
      searchUserFactsMock.mockResolvedValue(many)
      const result = await composeAnswer({ userId: 'u1', question: 'what do you know about me?' })
      expect(result.context.filter((c) => c.kind === 'fact')).toHaveLength(8)
    })

    it('judges what the answer sees with Jev: ONE batched evidence_relevance call over thoughts, notes and facts, against the question as asked', async () => {
      searchTextFilesMock.mockResolvedValue([noteHit()])
      searchUserFactsMock.mockResolvedValue([factHit(), miaFact()])

      await composeAnswer({
        userId: 'u1',
        question: 'coastal activities?',
        retrievalQuery: 'a different retrieval probe',
      })

      expect(runEnforcedPerItemDecisionsMock).toHaveBeenCalledTimes(1)
      const [call] = relevanceCalls()
      expect(call!.surface).toBe('evidence')
      expect(call!.kind).toBe('evidence_relevance')
      expect(call!.state).toBe('Question: coastal activities?')
      expect(call!.items.map((i) => i.ref)).toEqual(['t1', 't2', 'n1', 'f1', 'f2'])
    })

    it('what Jev judged not relevant never reaches the answer model: thoughts, notes and facts alike', async () => {
      searchTextFilesMock.mockResolvedValue([noteHit()])
      searchUserFactsMock.mockResolvedValue([factHit(), miaFact()])
      jevRelevance({
        t2: ['not', { not: 0.9, partly: 0.08, relevant: 0.02 }],
        n1: ['not', { not: 0.8, partly: 0.1, relevant: 0.1 }],
        f2: ['not', { not: 0.7, partly: 0.2, relevant: 0.1 }],
      })
      llmChatCompletionMock.mockResolvedValue(
        chatResponse('Answer: Rice flour.\nEvidence:\n- Rice flour [id=t_001]\nUnknown:\n- none'),
      )

      const result = await composeAnswer({ userId: 'u1', question: 'coastal activities?' })

      expect(result.context.map((c) => c.id)).toEqual(['t_001', 'f_pool'])
      expect(userMessage()).not.toContain('Tartine sells day-old loaves')
      expect(userMessage()).not.toContain('f_mia')
    })

    it('if Jev finds nothing relevant at all, the answer says there is not enough in memory (no model call)', async () => {
      searchUserFactsMock.mockResolvedValue([factHit()])
      jevRelevance({
        t1: ['not', { not: 0.9, partly: 0.05, relevant: 0.05 }],
        t2: ['not', { not: 0.9, partly: 0.05, relevant: 0.05 }],
        f1: ['not', { not: 0.9, partly: 0.05, relevant: 0.05 }],
      })
      const result = await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
      expect(llmChatCompletionMock).not.toHaveBeenCalled()
      expect(result.context).toEqual([])
    })

    it('a failing relevance judgement fails the answer (no silent answer from retrieval order)', async () => {
      runEnforcedPerItemDecisionsMock.mockRejectedValue(new Error('jev down'))
      await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow('jev down')
      expect(llmChatCompletionMock).not.toHaveBeenCalled()
    })

    it('the chat model decides no relevance: the only chat call in compose is the answer', async () => {
      searchUserFactsMock.mockResolvedValue([factHit()])
      await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
      expect(llmChatCompletionMock.mock.calls[0]![0].logContext).toBe('compose_answer')
    })

    it('"what do you know about me?" gives the model every retrieved fact and the grouping rule, and cites them', async () => {
      classifyQueryIntentMock.mockResolvedValue({ ...localIntent, scope: 'global' })
      searchUserFactsMock.mockResolvedValue([factHit(), miaFact(), plateFact()])
      llmChatCompletionMock.mockResolvedValue(
        chatResponse(
          'Answer: Activities: swims at the local pool [id=f_pool]; Circumstances: a licence plate is stored [id=f_plate]; Mia (friend): barely drinks water [id=f_mia].\nEvidence:\n- Swims [id=f_pool]\n- Plate on file [id=f_plate]\n- Mia [id=f_mia]\nUnknown:\n- none',
        ),
      )

      const result = await composeAnswer({ userId: 'u1', question: 'what do you know about me?' })

      for (const id of ['f_pool', 'f_mia', 'f_plate']) expect(userMessage()).toContain(`[id=${id}]`)
      expect(systemMessage()).toContain('what do you know about me')
      expect(systemMessage()).toContain('group them by theme')
      expect([...result.citations].sort()).toEqual(['f_mia', 'f_plate', 'f_pool'])
      expect(result.answer).not.toContain('[secure:')
    })

    it('a floor override reaches the fact search (harness users only)', async () => {
      const harnessUser = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
      await withEvalRelevanceFloor(0.1, () =>
        composeAnswer({ userId: harnessUser, question: 'carbonara recipe' }),
      )
      expect(searchUserFactsMock).toHaveBeenCalledWith(
        harnessUser,
        expect.objectContaining({ minScore: 0.1 }),
      )
    })

    it('without facts nothing changes: no section in the prompt, the base system prompt, one LLM call', async () => {
      await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
      expect(userMessage()).not.toContain('Known facts')
      expect(systemMessage()).toBe(buildComposeSystemPrompt(false))
      expect(llmChatCompletionMock).toHaveBeenCalledTimes(1)
    })

    it('with facts the system prompt is the base prompt plus the known-facts rules', async () => {
      searchUserFactsMock.mockResolvedValue([factHit()])
      await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
      expect(systemMessage()).toBe(buildComposeSystemPrompt(false, true))
      expect(systemMessage().startsWith(buildComposeSystemPrompt(false))).toBe(true)
    })

    it('a failing fact search fails the answer (no silent answer without facts)', async () => {
      searchUserFactsMock.mockRejectedValue(new Error('fact search failed'))
      await expect(composeAnswer({ userId: 'u1', question: 'q' })).rejects.toThrow(
        'fact search failed',
      )
      expect(llmChatCompletionMock).not.toHaveBeenCalled()
    })

    it('never puts embedding values in the prompt or the returned context', async () => {
      searchUserFactsMock.mockResolvedValue([factHit({ embedding: [0.1, 0.2] })])
      const result = await composeAnswer({ userId: 'u1', question: 'q' })
      expect(userMessage().toLowerCase()).not.toContain('embedding')
      expect(JSON.stringify(result).toLowerCase()).not.toContain('embedding')
    })
  })

  describe('eval relevance floor override', () => {
    const harnessUser = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
    const withLowCandidate = () =>
      searchThoughtsMock.mockResolvedValue([
        ...sampleRetrieval,
        { ...sampleRetrieval[0]!, id: 't_low', score: 0.15 },
      ])

    it('lets a thought under the product floor into the context, and searches notes with the same floor', async () => {
      withLowCandidate()
      const result = await withEvalRelevanceFloor(0.1, () =>
        composeAnswer({ userId: harnessUser, question: 'carbonara recipe' }),
      )
      expect(result.context.map((c) => c.id)).toContain('t_low')
      expect(searchTextFilesMock).toHaveBeenCalledWith(
        harnessUser,
        expect.objectContaining({ minScore: 0.1 }),
      )
    })

    it('a stricter override drops thoughts the product floor would keep', async () => {
      llmChatCompletionMock.mockResolvedValue(
        chatResponse('Answer: Carbonara.\nEvidence:\n- Carbonara [id=t_001]\nUnknown:\n- none'),
      )
      const result = await withEvalRelevanceFloor(0.75, () =>
        composeAnswer({ userId: harnessUser, question: 'carbonara recipe' }),
      )
      expect(result.context.map((c) => c.id)).toEqual(['t_001'])
      expect(searchTextFilesMock).toHaveBeenCalledWith(
        harnessUser,
        expect.objectContaining({ minScore: 0.75 }),
      )
    })

    it('without an override the product floor applies, for a harness user too', async () => {
      withLowCandidate()
      const result = await composeAnswer({ userId: harnessUser, question: 'carbonara recipe' })
      expect(result.context.map((c) => c.id)).not.toContain('t_low')
      expect(searchTextFilesMock).toHaveBeenCalledWith(
        harnessUser,
        expect.objectContaining({ minScore: 0.22 }),
      )
    })

    it('refuses to compose for a real user while an override is active', async () => {
      await expect(
        withEvalRelevanceFloor(0.1, () => composeAnswer({ userId: 'u1', question: 'carbonara' })),
      ).rejects.toThrow(/harness billing users/)
    })

    it('reports below-floor scores relative to the overridden floor', async () => {
      withLowCandidate()
      const { belowFloor } = await withComposeObserver(harnessUser, () =>
        withEvalRelevanceFloor(0.2, () =>
          composeAnswer({ userId: harnessUser, question: 'carbonara recipe' }),
        ),
      )
      expect(belowFloor).toEqual([{ thoughts: 0.15, notePassages: null }])
    })
  })

  it('tells an eval observer the best thought and note-passage scores that fell under the floor', async () => {
    const harnessUser = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
    searchThoughtsMock.mockResolvedValue([
      ...sampleRetrieval,
      { ...sampleRetrieval[0]!, id: 't_low', score: 0.19 },
      { ...sampleRetrieval[0]!, id: 't_lower', score: 0.05 },
    ])
    searchTextFilesMock.mockImplementation(
      async (_user: string, input: { onBelowFloor?: (best: number | null) => void }) => {
        input.onBelowFloor?.(0.11)
        return []
      },
    )
    const { result, belowFloor } = await withComposeObserver(harnessUser, () =>
      composeAnswer({ userId: harnessUser, question: 'carbonara recipe' }),
    )
    expect(result.context.map((c) => c.id)).toEqual(['t_001', 't_002'])
    expect(belowFloor).toEqual([{ thoughts: 0.19, notePassages: 0.11 }])
  })

  it('reports null for a side that dropped nothing, and the user never sees the scores', async () => {
    const harnessUser = 'public-bench-personamem-v2-capture-gpt-4o-mini-p1'
    searchTextFilesMock.mockImplementation(
      async (_user: string, input: { onBelowFloor?: (best: number | null) => void }) => {
        input.onBelowFloor?.(null)
        return []
      },
    )
    const { result, belowFloor } = await withComposeObserver(harnessUser, () =>
      composeAnswer({ userId: harnessUser, question: 'carbonara recipe' }),
    )
    expect(belowFloor).toEqual([{ thoughts: null, notePassages: null }])
    expect(JSON.stringify(result)).not.toMatch(/belowFloor/)
  })

  it('composes unchanged for a real user: no observer, no below-floor bookkeeping', async () => {
    const result = await composeAnswer({ userId: 'u1', question: 'carbonara recipe' })
    expect(result.context.map((c) => c.id)).toEqual(['t_001', 't_002'])
  })

  it('puts matched note passages in the compose prompt and in the returned context', async () => {
    searchTextFilesMock.mockResolvedValue([noteHit()])
    const result = await composeAnswer({
      userId: 'u1',
      question: 'what fun activities could I try on a coastal trip?',
    })
    const userMessage = llmChatCompletionMock.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === 'user',
    )
    expect(userMessage.content).toContain('[id=f1]')
    expect(userMessage.content).toContain('taking an early morning out on the waves')

    const noteItem = result.context.find((c) => c.id === 'f1')
    expect(noteItem).toBeDefined()
    expect(noteItem!.category).toBe('note')
    expect(noteItem!.normalizedText).toContain('Conference trip')
    expect(noteItem!.normalizedText).toContain('early morning out on the waves')
    expect(noteItem!.createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    // thoughts keep their place; notes follow them
    expect(result.context.map((c) => c.id).slice(0, 2)).toEqual(['t_001', 't_002'])
  })

  it('lets the answer cite the note itself (the note id), not a passage', async () => {
    searchTextFilesMock.mockResolvedValue([noteHit()])
    llmChatCompletionMock.mockResolvedValue(
      chatResponse(
        'Answer: Surfing before the keynote.\nEvidence:\n- Early morning out on the waves [id=f1]\nUnknown:\n- none',
      ),
    )
    const result = await composeAnswer({ userId: 'u1', question: 'coastal activities?' })
    expect(result.citations).toEqual(['f1'])
    expect(result.retrieved.map((r) => r.id)).toEqual(['f1'])
  })

  it('answers from notes alone when no thought is relevant', async () => {
    searchThoughtsMock.mockResolvedValue([])
    searchTextFilesMock.mockResolvedValue([noteHit()])
    llmChatCompletionMock.mockResolvedValue(
      chatResponse('Answer: Surfing.\nEvidence:\n- Waves [id=f1]\nUnknown:\n- none'),
    )
    const result = await composeAnswer({ userId: 'u1', question: 'coastal activities?' })
    expect(llmChatCompletionMock).toHaveBeenCalled()
    expect(result.citations).toEqual(['f1'])
    expect(result.context.map((c) => c.id)).toEqual(['f1'])
  })

  it('never puts embedding values in the compose prompt or the returned context', async () => {
    searchTextFilesMock.mockResolvedValue([noteHit()])
    const result = await composeAnswer({ userId: 'u1', question: 'coastal activities?' })
    const messages = llmChatCompletionMock.mock.calls[0][0].messages as Array<{ content: string }>
    for (const m of messages) expect(m.content.toLowerCase()).not.toContain('embedding')
    expect(JSON.stringify(result).toLowerCase()).not.toContain('embedding')
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
        // the search returns the whole evidence pool; the caller's topK is the answer budget
        topK: 15,
        weights: { vector: 0.4, graph: 0.6 },
        queryEmbedding: expect.any(Array),
      }),
    )
    expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'what about graph weights?')
  })

  it('searches the whole evidence pool (15) and keeps 8 thoughts when no topK is given', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...sampleRetrieval[0]!,
      id: `t_${String(i).padStart(3, '0')}`,
      score: 0.9 - i / 100,
    }))
    searchThoughtsMock.mockResolvedValue(many)
    const result = await composeAnswer({ userId: 'u1', question: 'x' })
    expect(searchThoughtsMock).toHaveBeenCalledWith(
      expect.objectContaining({ topK: 15, weights: CONTEXT_WEIGHTS.default }),
    )
    expect(result.context.filter((c) => c.kind === 'thought')).toHaveLength(8)
  })

  it('a topK of 3 is the answer budget: Jev judges the pool, the answer keeps the 3 most relevant', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...sampleRetrieval[0]!,
      id: `t_${i}`,
      score: 0.9 - i / 100,
    }))
    searchThoughtsMock.mockResolvedValue(many)
    // the last three are the most relevant ones: relevance, not retrieval rank, decides
    jevRelevance({
      t4: ['relevant', { relevant: 0.99, partly: 0.005, not: 0.005 }],
      t5: ['relevant', { relevant: 0.98, partly: 0.01, not: 0.01 }],
      t6: ['relevant', { relevant: 0.97, partly: 0.02, not: 0.01 }],
      t1: ['partly', { partly: 0.6, relevant: 0.2, not: 0.2 }],
      t2: ['partly', { partly: 0.6, relevant: 0.2, not: 0.2 }],
      t3: ['partly', { partly: 0.6, relevant: 0.2, not: 0.2 }],
    })
    llmChatCompletionMock.mockResolvedValue(
      chatResponse('Answer: x.\nEvidence:\n- y [id=t_3]\nUnknown:\n- none'),
    )
    const result = await composeAnswer({ userId: 'u1', question: 'x', topK: 3 })
    expect(
      result.context
        .filter((c) => c.kind === 'thought')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['t_3', 't_4', 't_5'])
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
      personalization: false,
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
      personalization: false,
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
      personalization: false,
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
      },
    ])
    loadTemporalContextMock.mockResolvedValue(
      new Map([
        [
          't_skate',
          {
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
      ]),
    )
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
})

describe('compose system prompt — abstain contract', () => {
  it('forbids "Not in memory." while citing evidence that bears on the question', () => {
    const prompt = buildComposeSystemPrompt(false)
    expect(prompt).toContain('Never answer "Not in memory." while listing Evidence')
    expect(prompt).toContain('the Answer MUST state that fact as the user put it')
  })
})

describe('compose system prompt — retrieved forget instructions (S2b)', () => {
  it('has exactly one rule, one sentence: a retrieved request to forget something means the information is not used in the answer', () => {
    const prompt = buildComposeSystemPrompt(false)
    const rules = prompt.split('\n').filter((line) => /\bforget\b/i.test(line))
    expect(rules).toHaveLength(1)
    const rule = rules[0]!
    expect(rule.startsWith('- ')).toBe(true)
    // one sentence: a single terminal full stop, at the end
    expect(rule.match(/[.!?](?:\s|$)/g)).toHaveLength(1)
    expect(rule.endsWith('.')).toBe(true)
    expect(rule).toMatch(/do not use/i)
    // part of the hard rules, in both prompt variants
    expect(prompt.indexOf(rule)).toBeGreaterThan(prompt.indexOf('Hard rules:'))
    expect(prompt.indexOf(rule)).toBeLessThan(prompt.indexOf('Grounding profile rules'))
    expect(buildComposeSystemPrompt(true)).toContain(rule)
  })
})

describe('compose system prompt — known facts (F2)', () => {
  const prompt = buildComposeSystemPrompt(false, true)
  const factsRules = prompt.slice(buildComposeSystemPrompt(false).length)

  it('is appended only when facts were retrieved, after the base prompt and the computed-timeline suffix', () => {
    expect(buildComposeSystemPrompt(false)).not.toContain('Known facts')
    expect(buildComposeSystemPrompt(true)).not.toContain('Known facts')
    const both = buildComposeSystemPrompt(true, true)
    expect(both.startsWith(buildComposeSystemPrompt(true))).toBe(true)
    expect(both.indexOf('Known facts rules')).toBeGreaterThan(
      both.indexOf('Computed timeline rules'),
    )
  })

  it("rule (a): facts about other people are not the user's", () => {
    expect(factsRules).toMatch(/Facts about other people are not the user's/)
    expect(factsRules).toMatch(/never attribute a fact about another person[^.]*to the user/i)
  })

  it('rule (b): no personal identifier in an answer unless asked; when asked, the reference token, never a guessed value', () => {
    expect(factsRules).toMatch(
      /Never write a reference or any identifier into the Answer or Evidence unless the user explicitly asked/,
    )
    expect(factsRules).toMatch(/\[secure:<id>\]/)
    expect(factsRules).toMatch(/Never guess or invent an identifier value/)
  })

  it('rule (c): "what do you know about me?" is answered from the facts, grouped by theme and person, with citations', () => {
    expect(factsRules).toMatch(/what do you know about me/i)
    expect(factsRules).toMatch(/group them by theme/)
    expect(factsRules).toMatch(/cite every fact/i)
    expect(factsRules).toMatch(/single Answer line/)
  })

  it('facts are citable evidence and an inferred fact is not presented as certain', () => {
    expect(factsRules).toMatch(/cite a fact with \[id=<fact id>\]/i)
    expect(factsRules).toMatch(/inferred/)
  })

  it('does not add a second line about forgetting to the base contract', () => {
    expect(factsRules.split('\n').filter((l) => /\bforget\b/i.test(l))).toEqual([])
  })
})
