import type { EnrichmentContext } from './enrichment-context'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtendedPrivateEnv } from '$lib/server/env/private-env'
import { runIngestWithRetries } from '$lib/server/ingest/retry'
import { createEvalLlmCache, withEvalLlmCache } from '$lib/server/llm/eval-llm-cache'
import type { LoadedUserOntology } from '$lib/server/ontology-db/load-ontology'
import { extractEnrichThoughtBundle } from './enrich-thought-bundle'

// Real llmChatCompletion + real eval cache + real bundle parse + the real ingest retry ladder;
// only the gateway (fetch), the database and the wallet are faked. The shape under test: the
// bundle answers "Dentist appointment on Friday at 9am" with a right date but timePrecision
// "hour". That reply must fail the attempt, leave no cache entry, and the next attempt must
// really ask the model again (it used to drop the date silently).

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    LLM_MIN_REQUEST_INTERVAL_MS: '0',
    LLM_REQUEST_TIMEOUT_MS: '',
    LLM_SERIAL_REQUESTS: '',
    OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
    SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key',
  } as ExtendedPrivateEnv,
}))

vi.mock('$lib/server/env/private-env', () => ({ env: mockEnv }))
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: vi.fn() }))
vi.mock('$lib/server/analytics/posthog-server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('$lib/server/billing/usage-gate', () => ({
  withPlatformBilling: vi.fn(
    async (_userId: string, _settle: (result: unknown) => number, fn: () => Promise<unknown>) =>
      fn(),
  ),
}))

const TENANT = 'public-bench-bundle-temporal-test'
const TEXT = 'Dentist appointment on Friday at 9am'

function makeContext(): EnrichmentContext {
  const kinds = [
    {
      id: 'ek-task',
      key: 'task',
      name: 'Task',
      definition: 'Something to do',
      kindType: 'thought_category' as const,
      active: true,
      neverStale: false,
    },
  ]
  const ontology = {
    entityKinds: kinds,
    entityKindsByKey: new Map(kinds.map((k) => [k.key, k])),
  } as LoadedUserOntology
  return {
    userId: TENANT,
    thoughtId: 'thought-1',
    normalizedText: TEXT,
    rawText: TEXT,
    ontology,
    profile: { version: 2 },
    groundingProfile: null,
    knownEntities: [],
    recentThoughts: [],
    categoryDistribution: new Map(),
    communityExcerpts: [],
    completeness: {
      knownEntityCount: 0,
      recentThoughtCount: 0,
      communitySummaryCount: 0,
      hasProfileNotes: false,
      hasGroundingProfile: false,
    },
  } as EnrichmentContext
}

function bundleReply(timePrecision: string): Response {
  const content = JSON.stringify({
    category: { key: 'task', confidence: 0.9, alternatives: [] },
    cues: [],
    askQuestion: 'When is my dentist appointment?',
    temporalMentions: [
      {
        surface: 'Friday at 9am',
        kind: 'appointment',
        startAt: '2026-10-30T09:00:00+01:00',
        timePrecision,
        timezone: 'Europe/Berlin',
        isAllDay: false,
        confidence: 0.9,
        semanticSummary: 'Dentist appointment on Friday at 9am',
      },
    ],
    mentions: [],
    triples: [],
  })
  const body = { choices: [{ message: { content } }], usage: { cost: 0.001 } }
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
}

const attempt = () =>
  extractEnrichThoughtBundle({
    context: makeContext(),
    capturedAt: new Date('2026-10-27T10:00:00+01:00'),
    timezone: 'Europe/Berlin',
    ontologyEntityKinds: [],
  })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bundle-temporal-eval-cache-'))
  vi.clearAllMocks()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('enrich bundle temporal contract under the eval response cache', () => {
  it('a reply with timePrecision "hour" is evicted, the retry asks the model again and stores the good mention', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bundleReply('hour'))
      .mockResolvedValueOnce(bundleReply('exact'))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    const result = await withEvalLlmCache(cache, () => runIngestWithRetries(attempt))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cache.stats).toMatchObject({ hits: 0, misses: 2 })
    expect(result.temporalMentions).toHaveLength(1)
    expect(result.temporalMentions[0]).toMatchObject({
      timePrecision: 'exact',
      startAt: '2026-10-30T09:00:00+01:00',
    })
    // Only the good reply is on disk: one model directory holding one entry.
    const [modelDir] = readdirSync(dir)
    expect(readdirSync(join(dir, modelDir!))).toHaveLength(1)
  })

  it('a bad reply alone leaves nothing in the cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bundleReply('hour'))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await expect(attempt()).rejects.toThrow(/timePrecision.*"hour"/)
    })

    // The reply was stored by the cache and then evicted when the parse rejected it.
    const [modelDir] = readdirSync(dir)
    expect(readdirSync(join(dir, modelDir!))).toEqual([])
    expect(cache.stats).toMatchObject({ hits: 0, misses: 1 })
  })
})
