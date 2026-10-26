import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtendedPrivateEnv } from '$lib/server/env/private-env'
import { createEvalLlmCache, withEvalLlmCache } from '$lib/server/llm/eval-llm-cache'
import { extractTemporalMentions } from './temporal-extraction'

// Real llmChatCompletion + real eval cache + real extraction; only the gateway (fetch), the
// database and the wallet are faked. The shape under test is the PersonaMem p196 failure: the
// model answers a vague capture with prose, and the response cache used to replay that prose
// forever.

const { mockEnv, chargeMock } = vi.hoisted(() => ({
  mockEnv: {
    LLM_MIN_REQUEST_INTERVAL_MS: '0',
    LLM_REQUEST_TIMEOUT_MS: '',
    LLM_SERIAL_REQUESTS: '',
    OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
    SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key',
  } as ExtendedPrivateEnv,
  chargeMock: vi.fn(),
}))

vi.mock('$lib/server/env/private-env', () => ({ env: mockEnv }))
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: vi.fn() }))
vi.mock('$lib/server/analytics/posthog-server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('$lib/server/billing/usage-gate', () => ({
  withPlatformBilling: vi.fn(
    async (_userId: string, settle: (result: unknown) => number, fn: () => Promise<unknown>) => {
      const result = await fn()
      chargeMock(settle(result))
      return result
    },
  ),
}))

const MODEL_DIR = 'deepseek-deepseek-v4.1-flash-1017'
const TENANT = 'public-bench-personamem-v2-capture-test-p196'

function gatewayReply(content: string): Response {
  const body = { choices: [{ message: { content } }], usage: { cost: 0.001 } }
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
}

const PROSE = 'Please paste the text you would like help with and I will look at it.'
const dentist =
  '{"mentions":[{"surface":"next Wednesday","kind":"appointment","startAt":"2026-05-27T15:00:00.000Z","timePrecision":"exact","timezone":"UTC","isAllDay":false,"confidence":0.8,"semanticSummary":"Dentist"}]}'

const extract = (normalizedText: string) =>
  extractTemporalMentions({
    userId: TENANT,
    normalizedText,
    capturedAt: new Date('2026-05-20T12:00:00.000Z'),
    timezone: 'UTC',
  })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'temporal-eval-cache-'))
  vi.clearAllMocks()
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('temporal extraction under the eval response cache (p196)', () => {
  it('asks for JSON object mode on the wire', async () => {
    const fetchMock = vi.fn(async () => gatewayReply('{"mentions":[]}'))
    vi.stubGlobal('fetch', fetchMock)

    await withEvalLlmCache(createEvalLlmCache(dir), () => extract('can you help me with this?'))

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(JSON.parse(init.body).response_format).toEqual({ type: 'json_object' })
  })

  it('a prose answer fails the step, is not cached, and the retry really asks the model again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gatewayReply(PROSE))
      .mockResolvedValueOnce(gatewayReply('{"mentions":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await expect(extract('can you help me with this?')).rejects.toThrow(/JSON/)
      expect(existsSync(join(dir, MODEL_DIR))).toBe(false)

      await expect(extract('can you help me with this?')).resolves.toEqual([])
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cache.stats).toMatchObject({ hits: 0, misses: 2 })
    expect(readdirSync(join(dir, MODEL_DIR))).toHaveLength(1)
  })

  it('a valid answer is cached: the same capture is not paid twice', async () => {
    const fetchMock = vi.fn(async () => gatewayReply(dentist))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      expect(await extract('Dentist next Wednesday at 3pm')).toHaveLength(1)
      expect(await extract('Dentist next Wednesday at 3pm')).toHaveLength(1)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 })
  })

  it('JSON of the wrong shape fails the step and is evicted, so the retry asks the model again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(gatewayReply('{"events":[]}'))
      .mockResolvedValueOnce(gatewayReply(dentist))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)

    await withEvalLlmCache(cache, async () => {
      await expect(extract('Dentist next Wednesday at 3pm')).rejects.toThrow(/mentions/)
      expect(await extract('Dentist next Wednesday at 3pm')).toHaveLength(1)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(readdirSync(join(dir, MODEL_DIR))).toHaveLength(1)
  })
})
