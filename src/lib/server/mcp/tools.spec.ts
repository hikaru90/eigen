import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withEvalClock } from '$lib/server/llm/eval-clock'
import {
  BARE_SECRET_PLACEHOLDER_ERROR,
  unknownSecretPlaceholderError,
} from '$lib/server/security/note-secrets'
import { envPaste, FAKE_SECRETS, guardWouldTrip, leaks } from '$lib/test/secret-fixtures'
import {
  runAnswerQuestionTool,
  runAppendTextFileTool,
  runCaptureThoughtTool,
  runCreateTextFileTool,
  runGetTextFileTool,
  runListTextFilesTool,
  runUpdateTextFileTool,
  runDeleteThoughtTool,
  runDeleteThoughtsByRequestTool,
  runEditThoughtTool,
  runRetrieveThoughtsTool,
  runSearchTextFilesTool,
} from './tools'

const {
  searchThoughtsMock,
  captureThoughtMock,
  listThoughtsMock,
  editStoredThoughtMock,
  archiveThoughtForUserMock,
  getDbSelectMock,
  loadTemporalContextByThoughtIdsMock,
  createTextFileMock,
  getTextFileMock,
  listTextFilesMock,
  updateTextFileMock,
  appendTextFileMock,
  searchTextFilesMock,
  resolveMcpCaptureAuthorshipMock,
  listProjectsForUserMock,
  orderTaskInProjectMock,
  generateProjectPlanMock,
  createProjectMock,
  updateProjectLabelMock,
  updateProjectStatusMock,
  dismissProjectMock,
  mergeProjectEntitiesMock,
  loadOpenThreadsMock,
  retrieveThoughtRowsForDeleteRequestMock,
  resolveDeleteTargetsMock,
  composeAnswerMock,
  createThoughtEmbeddingMock,
  getDbUpdateMock,
  loadThoughtCaptureResultMock,
} = vi.hoisted(() => ({
  searchThoughtsMock: vi.fn(),
  captureThoughtMock: vi.fn(),
  listThoughtsMock: vi.fn(),
  editStoredThoughtMock: vi.fn(),
  archiveThoughtForUserMock: vi.fn(),
  getDbSelectMock: vi.fn(),
  loadTemporalContextByThoughtIdsMock: vi.fn(),
  createTextFileMock: vi.fn(),
  getTextFileMock: vi.fn(),
  listTextFilesMock: vi.fn(),
  updateTextFileMock: vi.fn(),
  appendTextFileMock: vi.fn(),
  searchTextFilesMock: vi.fn(),
  resolveMcpCaptureAuthorshipMock: vi.fn(),
  listProjectsForUserMock: vi.fn(),
  orderTaskInProjectMock: vi.fn(),
  generateProjectPlanMock: vi.fn(),
  createProjectMock: vi.fn(),
  updateProjectLabelMock: vi.fn(),
  updateProjectStatusMock: vi.fn(),
  dismissProjectMock: vi.fn(),
  mergeProjectEntitiesMock: vi.fn(),
  loadOpenThreadsMock: vi.fn(),
  retrieveThoughtRowsForDeleteRequestMock: vi.fn(),
  resolveDeleteTargetsMock: vi.fn(),
  composeAnswerMock: vi.fn(),
  createThoughtEmbeddingMock: vi.fn(),
  getDbUpdateMock: vi.fn(),
  loadThoughtCaptureResultMock: vi.fn(),
}))

vi.mock('$lib/server/qa/compose-answer', () => ({
  composeAnswer: composeAnswerMock,
}))

vi.mock('$lib/server/memory/project-list', () => ({
  listProjectsForUser: listProjectsForUserMock,
  createProject: createProjectMock,
  updateProjectLabel: updateProjectLabelMock,
  updateProjectStatus: updateProjectStatusMock,
  dismissProject: dismissProjectMock,
}))

vi.mock('$lib/server/memory/resolve-project-identity', () => ({
  mergeProjectEntities: mergeProjectEntitiesMock,
}))
vi.mock('$lib/server/memory/open-threads', () => ({
  loadOpenThreads: loadOpenThreadsMock,
}))

vi.mock('$lib/server/memory/generate-project-plan', () => ({
  generateProjectPlan: generateProjectPlanMock,
}))

vi.mock('$lib/server/memory/project-task-sequence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/memory/project-task-sequence')>()
  return {
    ...actual,
    orderTaskInProject: orderTaskInProjectMock,
  }
})

vi.mock('$lib/server/memory/project-timeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/memory/project-timeline')>()
  return {
    ...actual,
    listMilestonesForProject: vi.fn(async () => []),
  }
})

vi.mock('$lib/server/memory/temporal-context', () => ({
  loadTemporalContextByThoughtIds: loadTemporalContextByThoughtIdsMock,
  compactTemporalFieldsForMcp: vi.fn(
    (ctx: { temporalStatus: string; temporalEvents: unknown[] } | undefined, _now: Date) => {
      if (!ctx || ctx.temporalStatus === 'none') {
        return { temporalStatus: 'none', temporalSummary: undefined }
      }
      return {
        temporalStatus: ctx.temporalStatus,
        temporalSummary: '"task" (Jun 2, 2026) — EXPIRED',
      }
    },
  ),
  enhanceSnippetWithTemporalContext: vi.fn(
    (input: { snippet: string; storedAt: Date; temporalSummary?: string }) =>
      `${input.snippet} (stored ${input.storedAt.toISOString().slice(0, 10)}${input.temporalSummary ? `; ${input.temporalSummary}` : ''})`,
  ),
}))

vi.mock('$lib/server/retrieval/service', () => ({
  searchThoughts: searchThoughtsMock,
}))

vi.mock('$lib/server/retrieval/retrieve-for-delete', () => ({
  retrieveThoughtRowsForDeleteRequest: retrieveThoughtRowsForDeleteRequestMock,
}))

vi.mock('$lib/server/retrieval/resolve-delete-target', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('$lib/server/retrieval/resolve-delete-target')>()
  return {
    ...actual,
    resolveDeleteTargets: resolveDeleteTargetsMock,
  }
})

vi.mock('$lib/server/capture/service', () => ({
  captureThought: captureThoughtMock,
  listThoughts: listThoughtsMock,
  editStoredThought: editStoredThoughtMock,
  normalizeThoughtText: (raw: string) => ({
    normalized: raw.trim().replace(/\s+/g, ' '),
    metadata: { pipeline: 'ontology_llm_v1' },
  }),
}))

vi.mock('$lib/server/memory/lifecycle', () => ({
  archiveThoughtForUser: archiveThoughtForUserMock,
}))

vi.mock('$lib/server/db', () => ({
  getDb: () => ({
    select: getDbSelectMock,
    update: getDbUpdateMock,
  }),
}))

vi.mock('$lib/server/crypto/tenant-encryption', () => ({
  encryptTenantValue: vi.fn(async ({ plaintext }: { plaintext: string }) => `enc:${plaintext}`),
}))

vi.mock('$lib/server/capture/capture-result', () => ({
  loadThoughtCaptureResult: loadThoughtCaptureResultMock,
}))

vi.mock('$lib/server/agents/notify', () => ({ notifyThoughtUpdated: vi.fn() }))
vi.mock('$lib/server/agents/project-context', () => ({
  loadProjectContextForThought: vi.fn(async () => ({ projectEntityIds: [], projectLabels: [] })),
}))

vi.mock('$lib/server/llm/embedding', () => ({
  createThoughtEmbedding: createThoughtEmbeddingMock,
}))

vi.mock('$lib/server/text-files/service', () => ({
  createTextFile: createTextFileMock,
  getTextFile: getTextFileMock,
  listTextFiles: listTextFilesMock,
  updateTextFile: updateTextFileMock,
  appendTextFile: appendTextFileMock,
  searchTextFiles: searchTextFilesMock,
}))

vi.mock('$lib/server/memory/authorship', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/memory/authorship')>()
  return {
    ...actual,
    resolveMcpCaptureAuthorship: resolveMcpCaptureAuthorshipMock,
  }
})

function mockThoughtRow(row: Record<string, unknown> | null) {
  getDbSelectMock.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => (row ? [row] : [])),
      })),
    })),
  })
}

const QUERY_EMBEDDING = [0.25, 0.5]

describe('MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadTemporalContextByThoughtIdsMock.mockResolvedValue(new Map())
    searchTextFilesMock.mockResolvedValue([])
    createThoughtEmbeddingMock.mockResolvedValue(QUERY_EMBEDDING)
    resolveMcpCaptureAuthorshipMock.mockResolvedValue({
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
    })
  })

  it('rejects invalid search threshold', async () => {
    await expect(
      runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'x', threshold: 2 }),
    ).rejects.toThrow(/Invalid threshold/)
  })

  it('rejects whitespace thought_id', async () => {
    await expect(
      runEditThoughtTool({ userId: 'u1' }, { thought_id: '  ', edit_request: 'fix' }),
    ).rejects.toThrow(/Invalid thought_id/)
  })

  it('returns thought not found as error', async () => {
    mockThoughtRow(null)
    await expect(
      runEditThoughtTool({ userId: 'u1' }, { thought_id: 't1', edit_request: 'fix' }),
    ).rejects.toThrow(/Thought not found/)
    expect(editStoredThoughtMock).not.toHaveBeenCalled()
  })

  it('runCaptureThoughtTool persists raw and returns id+status+thought', async () => {
    captureThoughtMock.mockResolvedValue({
      id: 't1',
      normalizedText: 'hi',
      queueStatus: 'pending',
      enrichedAt: null,
    })
    const out = await runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi' })
    expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hi', {
      source: 'mcp',
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
    })
    expect(out).toEqual({
      thoughtId: 't1',
      status: 'pending',
      // Mocked stored row has no enrichedAt → capture-time category provisional.
      categoryProvisional: true,
      thought: { id: 't1', normalizedText: 'hi', queueStatus: 'pending', enrichedAt: null },
    })
  })

  it('runCaptureThoughtTool labels agent authorship from MCP Bearer API key', async () => {
    captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' })
    resolveMcpCaptureAuthorshipMock.mockResolvedValue({
      author: 'agent',
      authorLabel: 'Cursor',
      authorKeyId: 'key-1',
    })
    await runCaptureThoughtTool(
      { userId: 'u1', authenticatedApiKey: { id: 'key-1', name: 'Cursor' } },
      { raw: 'agent note' },
    )
    expect(resolveMcpCaptureAuthorshipMock).toHaveBeenCalledWith({
      authorPrefix: undefined,
      asUser: false,
      authenticatedApiKey: { id: 'key-1', name: 'Cursor' },
    })
    expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'agent note', {
      source: 'agent',
      author: 'agent',
      authorLabel: 'Cursor',
      authorKeyId: 'key-1',
    })
  })

  it('runCaptureThoughtTool honors as_user on MCP API key auth', async () => {
    captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' })
    await runCaptureThoughtTool(
      { userId: 'u1', authenticatedApiKey: { id: 'key-1', name: 'Cursor' } },
      { raw: 'human note', as_user: true },
    )
    expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'human note', {
      source: 'mcp',
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
    })
  })

  describe('eval clock', () => {
    const CLOCK = new Date('2025-03-01T09:00:00.000Z')
    const HARNESS_USER = 'public-bench-personamem-v2-ask-gpt-4o-mini-p78'

    it('capture_thought without captured_at uses the eval clock as the capture time', async () => {
      captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' })
      await withEvalClock(CLOCK, () =>
        runCaptureThoughtTool({ userId: HARNESS_USER }, { raw: 'I am vegetarian', as_user: true }),
      )
      const options = captureThoughtMock.mock.calls[0]?.[2] as { capturedAt?: Date }
      expect(options.capturedAt?.toISOString()).toBe(CLOCK.toISOString())
    })

    it('an explicit captured_at wins over the eval clock', async () => {
      captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' })
      await withEvalClock(CLOCK, () =>
        runCaptureThoughtTool(
          { userId: HARNESS_USER },
          { raw: 'old fact', captured_at: '2024-01-05T00:00:00.000Z' },
        ),
      )
      const options = captureThoughtMock.mock.calls[0]?.[2] as { capturedAt?: Date }
      expect(options.capturedAt?.toISOString()).toBe('2024-01-05T00:00:00.000Z')
    })

    it('without a clock capture_thought sets no capturedAt (wall clock)', async () => {
      captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' })
      await runCaptureThoughtTool({ userId: HARNESS_USER }, { raw: 'hi' })
      expect(captureThoughtMock.mock.calls[0]?.[2]).not.toHaveProperty('capturedAt')
    })

    it('a clock for a non-harness user throws before anything is stored', async () => {
      await expect(
        withEvalClock(CLOCK, () => runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi' })),
      ).rejects.toThrow(/harness/i)
      expect(captureThoughtMock).not.toHaveBeenCalled()
    })

    it('answer_question defaults reference_time to the eval clock; an explicit one wins', async () => {
      composeAnswerMock.mockResolvedValue({ answer: 'a', citations: [], retrieved: [], context: [] })
      await withEvalClock(CLOCK, () =>
        runAnswerQuestionTool({ userId: HARNESS_USER }, { question: 'what do I eat?' }),
      )
      expect(composeAnswerMock.mock.calls[0]?.[0].referenceTime.toISOString()).toBe(
        CLOCK.toISOString(),
      )

      await withEvalClock(CLOCK, () =>
        runAnswerQuestionTool(
          { userId: HARNESS_USER },
          { question: 'what do I eat?', reference_time: '2025-06-01T00:00:00.000Z' },
        ),
      )
      expect(composeAnswerMock.mock.calls[1]?.[0].referenceTime.toISOString()).toBe(
        '2025-06-01T00:00:00.000Z',
      )
    })

    it('retrieve_thoughts dates its temporal annotations with the eval clock, not the wall clock', async () => {
      searchThoughtsMock.mockResolvedValue([
        {
          id: 'a',
          normalizedText: 'dinner at 7',
          category: 'task',
          score: 0.02,
          vectorScore: 0.02,
          graphScore: 0,
          createdAt: new Date('2025-02-01T10:00:00.000Z'),
        },
      ])
      await withEvalClock(CLOCK, () =>
        runRetrieveThoughtsTool({ userId: HARNESS_USER }, { query: 'dinner' }),
      )
      expect(loadTemporalContextByThoughtIdsMock.mock.calls[0]?.[0].now.toISOString()).toBe(
        CLOCK.toISOString(),
      )
    })

    it('the recent-thoughts browse uses the eval clock too', async () => {
      listThoughtsMock.mockResolvedValue([
        {
          id: 'a',
          category: 'task',
          createdAt: new Date('2025-02-01T10:00:00.000Z'),
          normalizedText: 'dinner at 7',
          author: 'user',
          authorLabel: null,
          askQuestion: null,
        },
      ])
      await withEvalClock(CLOCK, () => runRetrieveThoughtsTool({ userId: HARNESS_USER }, {}))
      expect(loadTemporalContextByThoughtIdsMock.mock.calls[0]?.[0].now.toISOString()).toBe(
        CLOCK.toISOString(),
      )
    })

    it('retrieve_thoughts without a clock keeps using the wall clock', async () => {
      searchThoughtsMock.mockResolvedValue([
        {
          id: 'a',
          normalizedText: 'dinner at 7',
          category: 'task',
          score: 0.02,
          vectorScore: 0.02,
          graphScore: 0,
          createdAt: new Date('2025-02-01T10:00:00.000Z'),
        },
      ])
      const before = Date.now()
      await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'dinner' })
      const now = loadTemporalContextByThoughtIdsMock.mock.calls[0]?.[0].now as Date
      expect(now.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('answer_question with no clock leaves referenceTime unset', async () => {
      composeAnswerMock.mockResolvedValue({ answer: 'a', citations: [], retrieved: [], context: [] })
      await runAnswerQuestionTool({ userId: 'u1' }, { question: 'q?' })
      expect(composeAnswerMock.mock.calls[0]?.[0]).not.toHaveProperty('referenceTime')
    })

    it('answer_question under a clock for a non-harness user throws', async () => {
      await expect(
        withEvalClock(CLOCK, () => runAnswerQuestionTool({ userId: 'u1' }, { question: 'q?' })),
      ).rejects.toThrow(/harness/i)
      expect(composeAnswerMock).not.toHaveBeenCalled()
    })
  })

  it('runCaptureThoughtTool rejects empty/whitespace raw and non-object args', async () => {
    await expect(runCaptureThoughtTool({ userId: 'u1' }, { raw: '   ' })).rejects.toThrow(
      /raw is required/,
    )
    await expect(runCaptureThoughtTool({ userId: 'u1' }, null)).rejects.toThrow(/raw is required/)
  })

  it('runRetrieveThoughtsTool lists recent thoughts when query is omitted', async () => {
    listThoughtsMock.mockResolvedValue([
      {
        id: 't1',
        normalizedText: 'hello world',
        category: 'thought',
        createdAt: new Date('2024-01-01'),
        embedding: Array.from({ length: 1536 }, () => 0.1),
      },
    ])
    const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { top_k: 5 })) as {
      count: number
      results: Array<Record<string, unknown>>
    }
    expect(searchThoughtsMock).not.toHaveBeenCalled()
    expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
      limit: 5,
      fields: 'snippet',
      cursor: undefined,
      authorFilter: 'user',
    })
    expect(out.count).toBe(1)
    expect(out.results[0]).toMatchObject({
      id: 't1',
      category: 'thought',
      snippet: expect.stringContaining('hello world'),
      temporalStatus: 'none',
      createdAt: '2024-01-01T00:00:00.000Z',
    })
  })

  it('runRetrieveThoughtsTool recent browse includes askQuestion (string or null) per thought', async () => {
    listThoughtsMock.mockResolvedValue([
      {
        id: 't2',
        normalizedText: 'Call the plumber about the kitchen sink',
        askQuestion: 'What did I need to call the plumber about?',
        category: 'task',
        createdAt: new Date('2024-01-02'),
      },
      {
        id: 't1',
        normalizedText: 'hi',
        askQuestion: null,
        category: 'observation',
        createdAt: new Date('2024-01-01'),
      },
    ])
    const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { order: 'created_at' })) as {
      results: Array<Record<string, unknown>>
    }
    expect(out.results[0]).toMatchObject({
      id: 't2',
      askQuestion: 'What did I need to call the plumber about?',
    })
    expect(out.results[1]).toMatchObject({ id: 't1', askQuestion: null })
  })

  it('runRetrieveThoughtsTool treats whitespace-only query as recent browse', async () => {
    listThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: '   ', top_k: 3 })
    expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
      limit: 3,
      fields: 'snippet',
      cursor: undefined,
      authorFilter: 'user',
    })
    expect(searchThoughtsMock).not.toHaveBeenCalled()
  })

  it('runRetrieveThoughtsTool uses recent browse when order is created_at even with a query', async () => {
    listThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool(
      { userId: 'u1' },
      { query: 'eigenmesh recent thoughts', order: 'created_at', top_k: 10 },
    )
    expect(listThoughtsMock).toHaveBeenCalledWith('u1', {
      limit: 10,
      fields: 'snippet',
      cursor: undefined,
      authorFilter: 'user',
    })
    expect(searchThoughtsMock).not.toHaveBeenCalled()
  })

  it('runRetrieveThoughtsTool uses fast mode and snippet shape by default', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 'a',
        normalizedText: 'long normalized text here',
        category: 'thought',
        score: 0.02,
        vectorScore: 0.02,
        graphScore: 0,
        createdAt: new Date('2026-06-02T10:00:00.000Z'),
      },
    ])
    const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello' })) as {
      count: number
      results: Array<Record<string, unknown>>
    }
    expect(searchThoughtsMock).toHaveBeenCalledWith({
      userId: 'u1',
      query: 'hello',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
      authorFilter: 'user',
    })
    expect(out.count).toBe(1)
    expect(out.results[0]).toMatchObject({
      id: 'a',
      category: 'thought',
      temporalStatus: 'none',
      createdAt: '2026-06-02T10:00:00.000Z',
    })
    expect(out.results[0].snippet).toContain('stored 2026-06-02')
    expect(out.results[0]).not.toHaveProperty('normalizedText')
  })

  it('runRetrieveThoughtsTool includes temporal expiry fields when events exist', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 'a',
        normalizedText: 'ich würde heute nachmittag die app trennen',
        category: 'task',
        score: 0.02,
        vectorScore: 0.02,
        graphScore: 0,
        createdAt: new Date('2026-06-02T10:00:00.000Z'),
      },
    ])
    loadTemporalContextByThoughtIdsMock.mockResolvedValue(
      new Map([
        [
          'a',
          {
            temporalStatus: 'expired',
            temporalEvents: [
              {
                kind: 'reminder',
                semanticSummary: 'separate app',
                activePeriod: '[2026-06-02T12:00:00.000Z,2026-06-02T18:00:00.000Z)',
                expired: true,
              },
            ],
          },
        ],
      ]),
    )
    const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'task' })) as {
      results: Array<Record<string, unknown>>
    }
    expect(out.results[0]).toMatchObject({
      temporalStatus: 'expired',
      temporalSummary: expect.stringContaining('EXPIRED'),
    })
  })

  it('runRetrieveThoughtsTool passes relational queries through to searchThoughts', async () => {
    searchThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'Who is Jonas?' })
    expect(searchThoughtsMock).toHaveBeenCalledWith({
      userId: 'u1',
      query: 'Who is Jonas?',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
      authorFilter: 'user',
    })
  })

  it('runRetrieveThoughtsTool omits authorFilter when author is all', async () => {
    searchThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', author: 'all' })
    expect(searchThoughtsMock).toHaveBeenCalledWith({
      userId: 'u1',
      query: 'hello',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
    })
    expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
      query: 'hello',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
    })
  })

  it('runRetrieveThoughtsTool omits authorFilter when include_agent is true', async () => {
    searchThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', include_agent: true })
    expect(searchThoughtsMock).toHaveBeenCalledWith({
      userId: 'u1',
      query: 'hello',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
    })
  })

  it('runRetrieveThoughtsTool passes authorFilter agent when requested', async () => {
    searchThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', author: 'agent' })
    expect(searchThoughtsMock).toHaveBeenCalledWith({
      userId: 'u1',
      query: 'hello',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
      authorFilter: 'agent',
    })
    expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
      query: 'hello',
      topK: 10,
      queryEmbedding: QUERY_EMBEDDING,
      authorFilter: 'agent',
    })
  })

  it('runRetrieveThoughtsTool filters by normalized RRF threshold when provided', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 'a',
        normalizedText: 'A',
        category: 'thought',
        score: 0.6,
        vectorScore: 0.6,
        graphScore: 0,
        createdAt: new Date('2026-06-02T10:00:00.000Z'),
      },
      {
        id: 'b',
        normalizedText: 'B',
        category: 'thought',
        score: 0.2,
        vectorScore: 0.2,
        graphScore: 0,
        createdAt: new Date('2026-06-02T10:00:00.000Z'),
      },
    ])
    const out = (await runRetrieveThoughtsTool(
      { userId: 'u1' },
      { query: 'hi', top_k: 5, threshold: 0.5 },
    )) as { results: Array<{ id: string }> }
    expect(out.results).toEqual([
      {
        id: 'a',
        category: 'thought',
        snippet: expect.stringContaining('A'),
        scoreNormalized: expect.any(Number),
        createdAt: '2026-06-02T10:00:00.000Z',
        temporalStatus: 'none',
      },
    ])
  })

  it('runDeleteThoughtTool soft-archives by thought_id', async () => {
    archiveThoughtForUserMock.mockResolvedValue({ ok: true })
    const out = await runDeleteThoughtTool({ userId: 'u1' }, { thought_id: 't1' })
    expect(archiveThoughtForUserMock).toHaveBeenCalledWith('u1', 't1')
    expect(out).toEqual({ archived: true, thoughtId: 't1', status: 'archived' })
  })

  it('runDeleteThoughtTool accepts id alias from compact retrieve candidates', async () => {
    archiveThoughtForUserMock.mockResolvedValue({ ok: true })
    const out = await runDeleteThoughtTool(
      { userId: 'u1' },
      { id: '829b4cc7-ee30-403f-975b-f4663f52eb00' },
    )
    expect(archiveThoughtForUserMock).toHaveBeenCalledWith(
      'u1',
      '829b4cc7-ee30-403f-975b-f4663f52eb00',
    )
    expect(out).toEqual({
      archived: true,
      thoughtId: '829b4cc7-ee30-403f-975b-f4663f52eb00',
      status: 'archived',
    })
  })

  describe('runDeleteThoughtsByRequestTool', () => {
    const deleteRequest = 'delete my recipes'
    const retrieveResults = [
      {
        id: 't1',
        normalizedText: 'Recipe: Japanese glazed salmon',
        category: 'reference',
        score: 0.9,
      },
      {
        id: 't2',
        normalizedText: 'Recipe: Lemon Herb Roast Chicken',
        category: 'reference',
        score: 0.8,
      },
    ]

    function mockRetrieve(): void {
      retrieveThoughtRowsForDeleteRequestMock.mockResolvedValue({
        queries: ['recipes cooking dishes'],
        results: retrieveResults,
      })
    }

    it('resolves targets through the Jev gate and soft-archives each selected id', async () => {
      mockRetrieve()
      resolveDeleteTargetsMock.mockResolvedValue([
        { thoughtId: 't1', snippet: 'Recipe: Japanese glazed salmon', scoreNormalized: 0.9 },
        { thoughtId: 't2', snippet: 'Recipe: Lemon Herb Roast Chicken', scoreNormalized: 0.85 },
      ])
      archiveThoughtForUserMock.mockResolvedValue({ ok: true })

      const out = await runDeleteThoughtsByRequestTool(
        { userId: 'u1' },
        { request: `  ${deleteRequest}  ` },
      )

      expect(retrieveThoughtRowsForDeleteRequestMock).toHaveBeenCalledWith({
        userId: 'u1',
        deleteRequest,
      })
      expect(resolveDeleteTargetsMock).toHaveBeenCalledWith({
        userId: 'u1',
        deleteRequest,
        candidates: expect.arrayContaining([
          expect.objectContaining({ thoughtId: 't1' }),
          expect.objectContaining({ thoughtId: 't2' }),
        ]),
      })
      expect(archiveThoughtForUserMock).toHaveBeenCalledTimes(2)
      expect(archiveThoughtForUserMock).toHaveBeenNthCalledWith(1, 'u1', 't1')
      expect(archiveThoughtForUserMock).toHaveBeenNthCalledWith(2, 'u1', 't2')
      expect(out).toEqual({ deleted: ['t1', 't2'], request: deleteRequest })
    })

    it('returns a no-match message and deletes nothing when the gate selects nothing', async () => {
      mockRetrieve()
      resolveDeleteTargetsMock.mockResolvedValue([])

      const out = await runDeleteThoughtsByRequestTool(
        { userId: 'u1' },
        { request: 'delete my childhood photos' },
      )

      expect(out.deleted).toEqual([])
      expect(String(out.message)).toMatch(/no matching thoughts/i)
      expect(archiveThoughtForUserMock).not.toHaveBeenCalled()
    })

    it('propagates the delete-gate ambiguity error and deletes nothing', async () => {
      mockRetrieve()
      resolveDeleteTargetsMock.mockRejectedValue(
        new Error(
          '[delete-gate] ambiguous delete request — refine it (best match confidence 0.90)',
        ),
      )

      await expect(
        runDeleteThoughtsByRequestTool({ userId: 'u1' }, { request: deleteRequest }),
      ).rejects.toThrow(/\[delete-gate\] ambiguous delete request/)
      expect(archiveThoughtForUserMock).not.toHaveBeenCalled()
    })

    it('surfaces a not-found error when a selected thought cannot be archived', async () => {
      mockRetrieve()
      resolveDeleteTargetsMock.mockResolvedValue([
        { thoughtId: 't1', snippet: 'Recipe: Japanese glazed salmon', scoreNormalized: 0.9 },
      ])
      archiveThoughtForUserMock.mockResolvedValue({ ok: false, reason: 'not_found' })

      await expect(
        runDeleteThoughtsByRequestTool({ userId: 'u1' }, { request: deleteRequest }),
      ).rejects.toThrow(/Thought not found/)
    })

    it('rejects a blank or missing request before any retrieval, gate, or deletion', async () => {
      await expect(
        runDeleteThoughtsByRequestTool({ userId: 'u1' }, { request: '   ' }),
      ).rejects.toThrow(/request is required/)
      await expect(runDeleteThoughtsByRequestTool({ userId: 'u1' }, {})).rejects.toThrow(
        /request is required/,
      )
      expect(retrieveThoughtRowsForDeleteRequestMock).not.toHaveBeenCalled()
      expect(resolveDeleteTargetsMock).not.toHaveBeenCalled()
      expect(archiveThoughtForUserMock).not.toHaveBeenCalled()
    })

    it('rejects an oversized request before any retrieval', async () => {
      await expect(
        runDeleteThoughtsByRequestTool({ userId: 'u1' }, { request: 'a'.repeat(501) }),
      ).rejects.toThrow(/500/)
      expect(retrieveThoughtRowsForDeleteRequestMock).not.toHaveBeenCalled()
      expect(archiveThoughtForUserMock).not.toHaveBeenCalled()
    })
  })

  it('runCaptureThoughtTool resolves author prefix to agent authorship', async () => {
    resolveMcpCaptureAuthorshipMock.mockResolvedValue({
      author: 'agent',
      authorLabel: 'cursor',
      authorKeyId: 'key-1',
    })
    captureThoughtMock.mockResolvedValue({ id: 't1', queueStatus: 'pending' })
    await runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi', author: 'eigen_abcd' })
    expect(resolveMcpCaptureAuthorshipMock).toHaveBeenCalledWith({
      authorPrefix: 'eigen_abcd',
      asUser: false,
      authenticatedApiKey: undefined,
    })
    expect(captureThoughtMock).toHaveBeenCalledWith('u1', 'hi', {
      source: 'agent',
      author: 'agent',
      authorLabel: 'cursor',
      authorKeyId: 'key-1',
    })
  })

  it('runCaptureThoughtTool rejects unknown author prefix', async () => {
    resolveMcpCaptureAuthorshipMock.mockRejectedValue(
      new Error('No API key matches author prefix "bad"'),
    )
    await expect(
      runCaptureThoughtTool({ userId: 'u1' }, { raw: 'hi', author: 'bad' }),
    ).rejects.toThrow(/No API key matches/)
  })

  it('runCreateTextFileTool passes resolved authorship', async () => {
    resolveMcpCaptureAuthorshipMock.mockResolvedValue({
      author: 'agent',
      authorLabel: 'claude',
      authorKeyId: 'key-1',
    })
    createTextFileMock.mockResolvedValue({
      id: 'f1',
      title: 'Note',
      body: 'hello',
      author: 'agent',
      authorLabel: 'claude',
      authorKeyId: 'key-1',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    })
    await runCreateTextFileTool(
      { userId: 'u1' },
      { body: 'hello', title: 'Note', author: 'eigen_xyz' },
    )
    expect(createTextFileMock).toHaveBeenCalledWith('u1', {
      title: 'Note',
      body: 'hello',
      authorship: {
        author: 'agent',
        authorLabel: 'claude',
        authorKeyId: 'key-1',
      },
    })
  })

  it('runCreateTextFileTool returns sanitized payload without embedding', async () => {
    createTextFileMock.mockResolvedValue({
      id: 'f1',
      title: 'Note',
      body: 'hello',
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    })
    const out = await runCreateTextFileTool({ userId: 'u1' }, { body: 'hello', title: 'Note' })
    expect(out).toMatchObject({ textFileId: 'f1', textFile: { body: 'hello' } })
    expect(out).not.toHaveProperty('embedding')
  })

  it('runCreateTextFileTool accepts title-only notes', async () => {
    createTextFileMock.mockResolvedValue({
      id: 'f2',
      title: 'shopping list',
      body: '',
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    })
    const out = await runCreateTextFileTool({ userId: 'u1' }, { title: 'shopping list' })
    expect(createTextFileMock).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'shopping list', body: undefined }),
    )
    expect(out).toMatchObject({ textFileId: 'f2', textFile: { title: 'shopping list', body: '' } })
  })

  it('runCreateTextFileTool rejects when title and body are both empty', async () => {
    await expect(runCreateTextFileTool({ userId: 'u1' }, {})).rejects.toThrow(
      /title or body is required/,
    )
    expect(createTextFileMock).not.toHaveBeenCalled()
  })

  it('runRetrieveThoughtsTool embeds the query once and shares it with thought and note search', async () => {
    searchThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'coastal trip activities' })
    expect(createThoughtEmbeddingMock).toHaveBeenCalledTimes(1)
    expect(createThoughtEmbeddingMock).toHaveBeenCalledWith('u1', 'coastal trip activities')
    expect(searchThoughtsMock.mock.calls[0]![0]).toMatchObject({ queryEmbedding: QUERY_EMBEDDING })
    expect(searchTextFilesMock.mock.calls[0]![1]).toMatchObject({ queryEmbedding: QUERY_EMBEDDING })
  })

  it('runRetrieveThoughtsTool uses the caller threshold as the note relevance floor', async () => {
    searchThoughtsMock.mockResolvedValue([])
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello', threshold: 0.4 })
    expect(searchTextFilesMock.mock.calls[0]![1]).toMatchObject({ minScore: 0.4 })
    searchTextFilesMock.mockClear()
    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'hello' })
    expect(searchTextFilesMock.mock.calls[0]![1]).not.toHaveProperty('minScore')
  })

  it('runRetrieveThoughtsTool returns note excerpts (passage + neighbours) with no embedding values', async () => {
    searchThoughtsMock.mockResolvedValue([])
    searchTextFilesMock.mockResolvedValue([
      {
        id: 'f1',
        title: 'Conference trip',
        preview: 'Taking an early morning out on the waves',
        excerpt: 'Before the keynote: taking an early morning out on the waves.',
        matchedOrdinals: [3],
        score: 0.4,
        vectorScore: 0.4,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        author: 'user',
        authorLabel: null,
        authorKeyId: null,
        embedding: new Array(1536).fill(0.2),
      },
    ])
    const out = (await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'coastal trip' })) as {
      textFiles: Array<Record<string, unknown>>
    }
    expect(out.textFiles).toHaveLength(1)
    expect(out.textFiles[0]).toMatchObject({
      id: 'f1',
      title: 'Conference trip',
      excerpt: expect.stringContaining('early morning out on the waves'),
      createdAt: '2026-03-01T00:00:00.000Z',
    })
    expect(JSON.stringify(out).toLowerCase()).not.toContain('embedding')
  })

  it('runSearchTextFilesTool returns note excerpts with no embedding values', async () => {
    searchTextFilesMock.mockResolvedValue([
      {
        id: 'f1',
        title: 'Trip',
        preview: 'x',
        excerpt: 'surfing at dawn',
        matchedOrdinals: [0],
        score: 0.5,
        vectorScore: 0.5,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
        author: 'user',
        authorLabel: null,
        authorKeyId: null,
        queryEmbedding: new Array(1536).fill(0.2),
      },
    ])
    const out = await runSearchTextFilesTool({ userId: 'u1' }, { query: 'surf' })
    expect(JSON.stringify(out)).toContain('surfing at dawn')
    expect(JSON.stringify(out).toLowerCase()).not.toContain('embedding')
  })

  it('runSearchTextFilesTool searches notes with author filter', async () => {
    searchTextFilesMock.mockResolvedValue([
      {
        id: 'f1',
        title: 'R',
        preview: 'x',
        excerpt: 'x',
        matchedOrdinals: [0],
        score: 1,
        vectorScore: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        author: 'user',
        authorLabel: null,
        authorKeyId: null,
      },
    ])
    const out = await runSearchTextFilesTool(
      { userId: 'u1' },
      { query: 'hello', top_k: 10, author: 'agent' },
    )
    expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
      query: 'hello',
      topK: 10,
      authorFilter: 'agent',
    })
    expect(out).toMatchObject({ count: 1 })
  })

  it('runListProjectsTool returns waterfall shape without embedding', async () => {
    listProjectsForUserMock.mockResolvedValue([
      {
        entityId: 'p1',
        label: 'Ship',
        status: 'active',
        source: 'manual',
        nextAction: {
          thoughtId: 't1',
          summary: 'Draft',
          itemId: 'task:t1',
        },
        openTaskCount: 2,
        targetDate: '2026-09-01T00:00:00.000Z',
        tasks: [
          { thoughtId: 't1', summary: 'Draft', itemId: 'task:t1', rank: 1 },
          { thoughtId: 't2', summary: 'Review', itemId: 'task:t2', rank: 2 },
        ],
        milestones: [
          {
            id: 'm1',
            label: 'Beta',
            targetDate: '2026-08-01T00:00:00.000Z',
            rank: 1,
            completedAt: null,
            linkedThoughtId: null,
          },
        ],
      },
    ])
    const { runListProjectsTool } = await import('./tools')
    const out = await runListProjectsTool({ userId: 'u1' }, {})
    expect(out).toMatchObject({
      count: 1,
      projects: [
        {
          entityId: 'p1',
          targetDate: '2026-09-01T00:00:00.000Z',
        },
      ],
    })
    const projects = (out as { projects: Array<{ tasks: unknown[]; milestones: unknown[] }> })
      .projects
    expect(projects[0]?.tasks).toHaveLength(2)
    expect(projects[0]?.tasks[0]).toMatchObject({ thoughtId: 't1', rank: 1 })
    expect(projects[0]?.milestones[0]).toMatchObject({ label: 'Beta' })
    expect(JSON.stringify(out)).not.toContain('embedding')
  })

  it('runOrderTaskInProjectTool renumbers via shared helper', async () => {
    orderTaskInProjectMock.mockResolvedValue({
      projectEntityId: 'p1',
      orderedThoughtIds: ['t2', 't1'],
    })
    const { runOrderTaskInProjectTool } = await import('./tools')
    const out = await runOrderTaskInProjectTool(
      { userId: 'u1' },
      { project_entity_id: 'p1', thought_id: 't2', rank: 1 },
    )
    expect(orderTaskInProjectMock).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      thoughtId: 't2',
      rank: 1,
      afterThoughtId: undefined,
    })
    expect(out).toMatchObject({ projectEntityId: 'p1', orderedThoughtIds: ['t2', 't1'] })
    expect(JSON.stringify(out)).not.toContain('embedding')
  })

  it('runListProjectsTool exposes the stalled signal per project', async () => {
    listProjectsForUserMock.mockResolvedValue([
      {
        entityId: 'p1',
        label: 'Ship',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 2,
        targetDate: '2026-08-01T00:00:00.000Z',
        stalled: { reason: 'deadline_overdue' },
        tasks: [],
        milestones: [],
      },
    ])
    const { runListProjectsTool } = await import('./tools')
    const out = await runListProjectsTool({ userId: 'u1' }, {})
    expect(out).toMatchObject({
      projects: [{ entityId: 'p1', stalled: { reason: 'deadline_overdue' } }],
    })
  })

  it('runGetProjectTimelineTool exposes the stalled signal', async () => {
    listProjectsForUserMock.mockResolvedValue([
      {
        entityId: 'p1',
        label: 'Ship',
        status: 'active',
        source: 'manual',
        nextAction: null,
        openTaskCount: 2,
        targetDate: null,
        stalled: { reason: 'no_next_action' },
        tasks: [],
        milestones: [],
      },
    ])
    const { runGetProjectTimelineTool } = await import('./tools')
    const out = await runGetProjectTimelineTool({ userId: 'u1' }, { project_entity_id: 'p1' })
    expect(out).toMatchObject({
      project: { entityId: 'p1', stalled: { reason: 'no_next_action' } },
    })
  })

  it('runOpenThreadsTool defaults to the all-author scope and passes the sweep through', async () => {
    loadOpenThreadsMock.mockResolvedValue({
      stalledProjects: [{ entityId: 'p1', label: 'Ship', stalled: { reason: 'deadline_overdue' } }],
      orphanThreads: [
        {
          thoughtId: 't1',
          category: 'task',
          createdAt: '2026-09-01T10:00:00.000Z',
          snippet: 'Sewer',
        },
      ],
    })
    const { runOpenThreadsTool } = await import('./tools')
    const out = await runOpenThreadsTool({ userId: 'u1' }, {})
    expect(loadOpenThreadsMock).toHaveBeenCalledWith('u1', { authorScope: 'all' })
    expect(out).toMatchObject({
      stalledProjects: [{ entityId: 'p1' }],
      orphanThreads: [{ thoughtId: 't1' }],
    })
    expect(JSON.stringify(out)).not.toContain('embedding')
  })

  it('runOpenThreadsTool honors author=user', async () => {
    loadOpenThreadsMock.mockResolvedValue({ stalledProjects: [], orphanThreads: [] })
    const { runOpenThreadsTool } = await import('./tools')
    await runOpenThreadsTool({ userId: 'u1' }, { author: 'user' })
    expect(loadOpenThreadsMock).toHaveBeenCalledWith('u1', { authorScope: 'user' })
  })

  it('runGenerateProjectPlanTool delegates to generateProjectPlan', async () => {
    generateProjectPlanMock.mockResolvedValue({
      projectEntityId: 'p1',
      projectLabel: 'Launch',
      targetDate: '2026-12-01T00:00:00.000Z',
      milestones: [],
      tasks: [
        {
          thoughtId: 't1',
          summary: 'Draft',
          rank: 1,
          isNextAction: true,
          suggestedStartAt: null,
          suggestedEndAt: null,
        },
      ],
    })
    const { runGenerateProjectPlanTool } = await import('./tools')
    const out = await runGenerateProjectPlanTool(
      { userId: 'u1' },
      { project_entity_id: 'p1', goal: 'Ship beta' },
    )
    expect(generateProjectPlanMock).toHaveBeenCalledWith({
      userId: 'u1',
      projectEntityId: 'p1',
      goal: 'Ship beta',
    })
    expect(out).toMatchObject({ projectEntityId: 'p1', tasks: [{ thoughtId: 't1' }] })
    expect(JSON.stringify(out)).not.toContain('embedding')
  })

  it('runCreateProjectTool creates a new project with label', async () => {
    createProjectMock.mockResolvedValue({
      entityId: 'p-new',
      label: 'New Project',
      status: 'active',
      source: 'manual',
    })
    const { runCreateProjectTool } = await import('./tools')
    const out = await runCreateProjectTool({ userId: 'u1' }, { label: 'New Project' })
    expect(createProjectMock).toHaveBeenCalledWith('u1', 'New Project', { status: 'active' })
    expect(out).toMatchObject({
      entityId: 'p-new',
      label: 'New Project',
      status: 'active',
      source: 'manual',
    })
  })

  it('runCreateProjectTool rejects empty label', async () => {
    const { runCreateProjectTool } = await import('./tools')
    await expect(runCreateProjectTool({ userId: 'u1' }, { label: '  ' })).rejects.toThrow(
      /label is required/,
    )
    expect(createProjectMock).not.toHaveBeenCalled()
  })

  it('runCreateProjectTool accepts someday status', async () => {
    createProjectMock.mockResolvedValue({
      entityId: 'p-someday',
      label: 'Someday Project',
      status: 'someday',
      source: 'manual',
    })
    const { runCreateProjectTool } = await import('./tools')
    const out = await runCreateProjectTool(
      { userId: 'u1' },
      { label: 'Someday Project', status: 'someday' },
    )
    expect(createProjectMock).toHaveBeenCalledWith('u1', 'Someday Project', { status: 'someday' })
    expect(out).toMatchObject({ status: 'someday' })
  })

  it('runEditProjectTool updates label', async () => {
    updateProjectLabelMock.mockResolvedValue({ entityId: 'p1', label: 'Updated Name' })
    const { runEditProjectTool } = await import('./tools')
    const out = await runEditProjectTool(
      { userId: 'u1' },
      { project_entity_id: 'p1', label: 'Updated Name' },
    )
    expect(updateProjectLabelMock).toHaveBeenCalledWith('u1', 'p1', 'Updated Name')
    expect(out).toMatchObject({ entityId: 'p1', label: 'Updated Name' })
  })

  it('runEditProjectTool updates status', async () => {
    updateProjectStatusMock.mockResolvedValue({ entityId: 'p1', status: 'completed' })
    const { runEditProjectTool } = await import('./tools')
    const out = await runEditProjectTool(
      { userId: 'u1' },
      { project_entity_id: 'p1', status: 'completed' },
    )
    expect(updateProjectStatusMock).toHaveBeenCalledWith('u1', 'p1', 'completed')
    expect(out).toMatchObject({ entityId: 'p1', status: 'completed' })
  })

  it('runEditProjectTool rejects when neither label nor status provided', async () => {
    const { runEditProjectTool } = await import('./tools')
    await expect(runEditProjectTool({ userId: 'u1' }, { project_entity_id: 'p1' })).rejects.toThrow(
      /At least one of label or status is required/,
    )
  })

  it('runEditProjectTool rejects invalid status', async () => {
    const { runEditProjectTool } = await import('./tools')
    await expect(
      runEditProjectTool({ userId: 'u1' }, { project_entity_id: 'p1', status: 'invalid' }),
    ).rejects.toThrow(/Invalid status/)
  })

  it('runDeleteProjectTool dismisses project', async () => {
    listProjectsForUserMock.mockResolvedValue([
      { entityId: 'p1', label: 'To Delete', status: 'active' },
    ])
    dismissProjectMock.mockResolvedValue(undefined)
    const { runDeleteProjectTool } = await import('./tools')
    const out = await runDeleteProjectTool({ userId: 'u1' }, { project_entity_id: 'p1' })
    expect(dismissProjectMock).toHaveBeenCalledWith('u1', 'p1')
    expect(out).toMatchObject({ deleted: true, entityId: 'p1', label: 'To Delete' })
  })

  it('runMergeProjectsTool folds duplicates into the kept project in one call (user authority)', async () => {
    listProjectsForUserMock.mockResolvedValue([
      { entityId: 'p1', label: 'Eigen', status: 'active' },
      { entityId: 'p2', label: 'EigenMesh', status: 'active' },
      { entityId: 'p3', label: 'eigenmesh', status: 'active' },
    ])
    mergeProjectEntitiesMock.mockResolvedValue(undefined)
    const { runMergeProjectsTool } = await import('./tools')
    const out = await runMergeProjectsTool(
      { userId: 'u1' },
      { into_project_entity_id: 'p2', project_entity_ids: ['p1', 'p3', 'p1'], label: ' EigenMesh ' },
    )
    expect(mergeProjectEntitiesMock).toHaveBeenCalledWith('u1', 'p2', ['p1', 'p3'], 'EigenMesh', 'user')
    expect(dismissProjectMock).not.toHaveBeenCalled()
    expect(out).toMatchObject({
      merged: true,
      into: { entityId: 'p2' },
      mergedProjects: [
        { entityId: 'p1', label: 'Eigen' },
        { entityId: 'p3', label: 'eigenmesh' },
      ],
    })
  })

  it('runMergeProjectsTool negative probes: unknown ids, self-merge, empty list — before any write', async () => {
    listProjectsForUserMock.mockResolvedValue([{ entityId: 'p1', label: 'Eigen', status: 'active' }])
    const { runMergeProjectsTool } = await import('./tools')
    await expect(
      runMergeProjectsTool({ userId: 'u1' }, { into_project_entity_id: 'p1', project_entity_ids: ['nope'] }),
    ).rejects.toThrow(/Project not found: nope/)
    await expect(
      runMergeProjectsTool({ userId: 'u1' }, { into_project_entity_id: 'p1', project_entity_ids: ['p1'] }),
    ).rejects.toThrow(/must not contain/)
    await expect(
      runMergeProjectsTool({ userId: 'u1' }, { into_project_entity_id: 'p1', project_entity_ids: [] }),
    ).rejects.toThrow(/non-empty array/)
    expect(mergeProjectEntitiesMock).not.toHaveBeenCalled()
  })

  it('runDeleteProjectTool rejects non-existent project', async () => {
    listProjectsForUserMock.mockResolvedValue([])
    const { runDeleteProjectTool } = await import('./tools')
    await expect(
      runDeleteProjectTool({ userId: 'u1' }, { project_entity_id: 'p-nonexistent' }),
    ).rejects.toThrow(/Project not found/)
    expect(dismissProjectMock).not.toHaveBeenCalled()
  })
})

describe('MCP tools secret hygiene (docs/planning/secret-hygiene.md)', () => {
  const SECRET_RAW = `deploy ${envPaste()}`

  beforeEach(() => {
    vi.clearAllMocks()
    loadTemporalContextByThoughtIdsMock.mockResolvedValue(new Map())
    searchTextFilesMock.mockResolvedValue([])
    createThoughtEmbeddingMock.mockResolvedValue(QUERY_EMBEDDING)
    resolveMcpCaptureAuthorshipMock.mockResolvedValue({
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
    })
  })

  it('capture_thought hands the original to the capture boundary and returns no secret value', async () => {
    captureThoughtMock.mockResolvedValue({
      id: 't1',
      normalizedText: 'deploy DATABASE_URL=[redacted]',
      queueStatus: 'pending',
      enrichedAt: null,
      // even a row that still carries the original (legacy / future bug) is scrubbed at the tool edge
      rawText: SECRET_RAW,
      metadata: { secretsRedacted: [{ kind: 'api_key', name: 'LLM_API_KEY' }] },
    })

    const out = await runCaptureThoughtTool({ userId: 'u1' }, { raw: SECRET_RAW })

    expect(captureThoughtMock.mock.calls[0]![1]).toBe(SECRET_RAW)
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(out.secretsRedacted).toEqual([{ kind: 'api_key', name: 'LLM_API_KEY' }])
    expect(out.thought.metadata).toEqual({
      secretsRedacted: [{ kind: 'api_key', name: 'LLM_API_KEY' }],
    })
  })

  it('retrieve_thoughts (full detail) returns no secret value from thoughts or notes', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 't1',
        rawText: SECRET_RAW,
        normalizedText: `key ${FAKE_SECRETS.githubClassic}`,
        category: 'observation',
        createdAt: new Date('2024-01-01'),
        score: 0.9,
      },
    ])
    searchTextFilesMock.mockResolvedValue([
      {
        id: 'f1',
        title: 'Runbook',
        preview: envPaste(),
        excerpt: `set ${envPaste()}`,
        matchedOrdinals: [0],
        score: 0.5,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
    ])

    const out = await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'deploy', detail: 'full' })

    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(JSON.stringify(out)).toContain('[redacted secret]')
  })

  it('retrieve_thoughts (snippet detail) and recent browse return no secret value', async () => {
    searchThoughtsMock.mockResolvedValue([
      {
        id: 't1',
        normalizedText: `key ${FAKE_SECRETS.githubClassic}`,
        category: 'observation',
        createdAt: new Date('2024-01-01'),
        score: 0.9,
      },
    ])
    expect(leaks(JSON.stringify(await runRetrieveThoughtsTool({ userId: 'u1' }, { query: 'key' })))).toBe(false)

    listThoughtsMock.mockResolvedValue([
      {
        id: 't2',
        rawText: SECRET_RAW,
        normalizedText: SECRET_RAW,
        category: 'observation',
        createdAt: new Date('2024-01-01'),
        askQuestion: `What is ${FAKE_SECRETS.githubClassic}?`,
      },
    ])
    for (const detail of ['snippet', 'full']) {
      const out = await runRetrieveThoughtsTool({ userId: 'u1' }, { detail })
      expect(leaks(JSON.stringify(out))).toBe(false)
    }
  })

  it('retrieve_thoughts embeds and searches a redacted query', async () => {
    searchThoughtsMock.mockResolvedValue([])
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    await runRetrieveThoughtsTool({ userId: 'u1' }, { query: `where is ${FAKE_SECRETS.githubClassic}` })

    expect(leaks(JSON.stringify(createThoughtEmbeddingMock.mock.calls))).toBe(false)
    expect(leaks(JSON.stringify(searchThoughtsMock.mock.calls))).toBe(false)
    expect(leaks(JSON.stringify(searchTextFilesMock.mock.calls))).toBe(false)
    expect(leaks(JSON.stringify(info.mock.calls))).toBe(false)
    info.mockRestore()
  })

  it('answer_question composes from a redacted question and returns no secret value', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    composeAnswerMock.mockResolvedValue({
      answer: `Your key is ${FAKE_SECRETS.openai}`,
      citations: [{ thoughtId: 't1', snippet: SECRET_RAW }],
      retrieved: [{ id: 't1', rawText: SECRET_RAW, normalizedText: SECRET_RAW }],
    })

    const out = await runAnswerQuestionTool(
      { userId: 'u1' },
      { question: `is ${FAKE_SECRETS.openai} still valid?` },
    )

    expect(guardWouldTrip(composeAnswerMock.mock.calls)).toBe(false)
    expect(leaks(JSON.stringify(composeAnswerMock.mock.calls))).toBe(false)
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(leaks(JSON.stringify(info.mock.calls))).toBe(false)
    info.mockRestore()
  })

  it('search_text_files and get/list note tools return no secret value', async () => {
    searchTextFilesMock.mockResolvedValue([
      { id: 'f1', title: 'Runbook', preview: SECRET_RAW, excerpt: SECRET_RAW, score: 0.5 },
    ])
    const out = await runSearchTextFilesTool({ userId: 'u1' }, { query: `find ${FAKE_SECRETS.openai}` })
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(leaks(JSON.stringify(searchTextFilesMock.mock.calls))).toBe(false)
  })

  it('create_text_file hands the verbatim body to the service (which indexes the redacted text) but returns it redacted', async () => {
    createTextFileMock.mockResolvedValue({ id: 'f1', title: 'Runbook', body: SECRET_RAW })

    const out = await runCreateTextFileTool({ userId: 'u1' }, { title: 'Runbook', body: SECRET_RAW })

    expect(createTextFileMock.mock.calls[0]![1]).toMatchObject({ body: SECRET_RAW })
    expect(leaks(JSON.stringify(out))).toBe(false)
  })

  it('edit_thought raw_text replacement derives normalized and lexical text from the redacted text, logs and returns no secret', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    mockThoughtRow({
      id: 't1',
      rawText: SECRET_RAW,
      normalizedText: SECRET_RAW,
      category: 'task',
      metadata: {},
    })
    const set = vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 't1' }]) })),
    }))
    getDbUpdateMock.mockReturnValue({ set })
    loadThoughtCaptureResultMock.mockResolvedValue({
      id: 't1',
      normalizedText: 'replaced',
      category: 'task',
      metadata: {},
    })

    const out = await runEditThoughtTool(
      { userId: 'u1' },
      { thought_id: 't1', raw_text: `new ${envPaste()}` },
    )

    const written = (set.mock.calls[0] as unknown as [Record<string, string>])[0]
    expect(leaks(written.normalizedText)).toBe(false)
    expect(leaks(written.normalizedTextEncrypted)).toBe(false)
    expect(leaks(written.lexicalText)).toBe(false)
    // the user's replacement words stay verbatim in raw_text
    expect(written.rawText).toBe(`new ${envPaste()}`)
    // the response shows the thought as it was before (original text) — scrubbed at the tool edge
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(leaks(JSON.stringify(info.mock.calls))).toBe(false)
    info.mockRestore()
  })
})

describe('MCP note tools: numbered placeholders for the chat agent (docs/planning/secret-hygiene.md, Part 2)', () => {
  const STORED = [
    'Deploy runbook, versoin 3',
    `LLM_API_KEY=${FAKE_SECRETS.openai}`,
    'Restart the worker afterwards.',
    `GITHUB_TOKEN=${FAKE_SECRETS.githubClassic}`,
  ].join('\n')
  const SHOWN = [
    'Deploy runbook, versoin 3',
    'LLM_API_KEY=[redacted secret #1]',
    'Restart the worker afterwards.',
    'GITHUB_TOKEN=[redacted secret #2]',
  ].join('\n')

  function note(body: string) {
    return {
      id: 'f1',
      title: 'Runbook',
      body,
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resolveMcpCaptureAuthorshipMock.mockResolvedValue({
      author: 'user',
      authorLabel: null,
      authorKeyId: null,
    })
  })

  it('get_text_file shows each secret as [redacted secret #n], in order, and no value', async () => {
    getTextFileMock.mockResolvedValue(note(STORED))

    const out = await runGetTextFileTool({ userId: 'u1' }, { text_file_id: 'f1' })

    expect(out.textFile.body).toBe(SHOWN)
    expect(leaks(JSON.stringify(out))).toBe(false)
    expect(guardWouldTrip(out)).toBe(false)
  })

  it('list_text_files numbers the secrets of every note', async () => {
    listTextFilesMock.mockResolvedValue([note(STORED), { ...note('plain'), id: 'f2' }])

    const out = await runListTextFilesTool({ userId: 'u1' }, {})

    expect(out.textFiles.map((file: { body: string }) => file.body)).toEqual([SHOWN, 'plain'])
    expect(leaks(JSON.stringify(out))).toBe(false)
  })

  it('update_text_file is an agent write: the service restores, and the result shows placeholders again', async () => {
    const fixed = STORED.replace('versoin', 'version')
    updateTextFileMock.mockResolvedValue(note(fixed))

    const out = await runUpdateTextFileTool(
      { userId: 'u1' },
      { text_file_id: 'f1', body: SHOWN.replace('versoin', 'version') },
    )

    expect(updateTextFileMock).toHaveBeenCalledWith(
      'u1',
      'f1',
      { title: undefined, body: SHOWN.replace('versoin', 'version') },
      { agentWrite: true },
    )
    expect(out.textFile.body).toBe(SHOWN.replace('versoin', 'version'))
    expect(leaks(JSON.stringify(out))).toBe(false)
  })

  it('append_text_file is an agent write and its result shows placeholders, not values', async () => {
    appendTextFileMock.mockResolvedValue(note(`${STORED}\nRotate the keys.`))

    const out = await runAppendTextFileTool(
      { userId: 'u1' },
      { text_file_id: 'f1', text: 'Rotate the keys.' },
    )

    expect(appendTextFileMock).toHaveBeenCalledWith(
      'u1',
      'f1',
      { text: 'Rotate the keys.', separator: undefined },
      { agentWrite: true },
    )
    expect(out.textFile.body).toBe(`${SHOWN}\nRotate the keys.`)
    expect(leaks(JSON.stringify(out))).toBe(false)
  })

  it('a service refusal (unknown ordinal / bare placeholder) surfaces as the tool error, unchanged', async () => {
    updateTextFileMock.mockRejectedValue(new Error(unknownSecretPlaceholderError('7')))
    await expect(
      runUpdateTextFileTool(
        { userId: 'u1' },
        { text_file_id: 'f1', body: 'x [redacted secret #7]' },
      ),
    ).rejects.toThrow(
      'placeholder #7 does not exist in this note; keep placeholders exactly as returned',
    )

    appendTextFileMock.mockRejectedValue(new Error(BARE_SECRET_PLACEHOLDER_ERROR))
    await expect(
      runAppendTextFileTool({ userId: 'u1' }, { text_file_id: 'f1', text: 'k: [redacted secret]' }),
    ).rejects.toThrow(/Notes editor/)
  })

  it('create_text_file rejects any placeholder (a new note has no secrets to restore) and saves nothing', async () => {
    await expect(
      runCreateTextFileTool({ userId: 'u1' }, { title: 'T', body: 'key [redacted secret #1]' }),
    ).rejects.toThrow(unknownSecretPlaceholderError('1'))
    await expect(
      runCreateTextFileTool({ userId: 'u1' }, { title: 'T', body: 'key [redacted secret]' }),
    ).rejects.toThrow(BARE_SECRET_PLACEHOLDER_ERROR)
    await expect(
      runCreateTextFileTool({ userId: 'u1' }, { title: 'key [redacted secret]' }),
    ).rejects.toThrow(BARE_SECRET_PLACEHOLDER_ERROR)
    expect(createTextFileMock).not.toHaveBeenCalled()
  })

  it('create_text_file result numbers the secrets of the saved body', async () => {
    createTextFileMock.mockResolvedValue(note(STORED))
    const out = await runCreateTextFileTool({ userId: 'u1' }, { title: 'Runbook', body: STORED })
    expect(out.textFile.body).toBe(SHOWN)
    expect(leaks(JSON.stringify(out))).toBe(false)
  })

  it('search_text_files and retrieve_thoughts keep the numbered placeholders of an excerpt intact', async () => {
    const hit = {
      id: 'f1',
      title: 'Runbook',
      preview: 'LLM_API_KEY=[redacted secret #1]',
      excerpt: SHOWN,
      matchedOrdinals: [0],
      score: 0.5,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    }
    searchTextFilesMock.mockResolvedValue([hit])
    searchThoughtsMock.mockResolvedValue([])

    const searched = await runSearchTextFilesTool({ userId: 'u1' }, { query: 'runbook' })
    expect(searched.results[0].excerpt).toBe(SHOWN)

    for (const detail of ['snippet', 'full']) {
      const retrieved = await runRetrieveThoughtsTool(
        { userId: 'u1' },
        { query: 'runbook', detail },
      )
      expect(retrieved.textFiles[0].excerpt).toBe(SHOWN)
      expect(guardWouldTrip(retrieved)).toBe(false)
    }
  })
})
