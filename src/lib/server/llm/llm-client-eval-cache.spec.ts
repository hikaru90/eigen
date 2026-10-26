import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtendedPrivateEnv } from '$lib/server/env/private-env'
import { createEvalLlmCache, withEvalLlmCache } from './eval-llm-cache'
import { llmChatCompletion, llmCreateEmbeddings } from './llm-client'

const { mockEnv, logActivityCallMock, chargeMock, billingCalls } = vi.hoisted(() => ({
  mockEnv: {
    LLM_MIN_REQUEST_INTERVAL_MS: '0',
    LLM_REQUEST_TIMEOUT_MS: '',
    LLM_SERIAL_REQUESTS: '',
    OPENROUTER_BASE_URL: 'https://openrouter.example/api/v1',
    SERVICE_API_KEY_OPENROUTER: 'service-openrouter-key',
  } as ExtendedPrivateEnv,
  logActivityCallMock: vi.fn(),
  chargeMock: vi.fn(),
  billingCalls: { count: 0 },
}))

vi.mock('$lib/server/env/private-env', () => ({ env: mockEnv }))
vi.mock('$lib/server/db', () => ({ getDb: () => ({}) }))
vi.mock('$lib/server/activity/log-call', () => ({ logActivityCall: logActivityCallMock }))
vi.mock('$lib/server/analytics/posthog-server', () => ({ captureServerEvent: vi.fn() }))
// the real usage gate, minus the database: settle from the call result, then debit the wallet
vi.mock('$lib/server/billing/usage-gate', () => ({
  withPlatformBilling: vi.fn(
    async (_userId: string, settle: (result: unknown) => number, fn: () => Promise<unknown>) => {
      billingCalls.count += 1
      const result = await fn()
      chargeMock(settle(result))
      return result
    },
  ),
}))

const MODEL_DIR = 'deepseek-deepseek-v4.1-flash-1017'
const TENANT = 'public-bench-personamem-v2-capture-test-p1'

function ok(body: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response
}

const chatBody = { choices: [{ message: { content: '{"letter":"A"}' } }], usage: { cost: 0.004 } }
const embeddingBody = { data: [{ embedding: [0.1] }], usage: { cost: 0.0002 } }

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-client-cache-'))
  vi.clearAllMocks()
  chargeMock.mockReset()
  billingCalls.count = 0
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

const chat = (content = 'hello') =>
  llmChatCompletion({
    userId: TENANT,
    messages: [{ role: 'user', content }],
    temperature: 0,
    responseFormat: 'json_object',
  })

describe('llmChatCompletion with the eval cache', () => {
  it('a miss pays once, writes the response before the wallet is debited, and counts as paid', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    let filesWhenDebited = -1
    chargeMock.mockImplementation(() => {
      filesWhenDebited = readdirSync(join(dir, MODEL_DIR)).length
    })

    const result = await withEvalLlmCache(cache, () => chat())

    expect(result).toEqual(chatBody)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(billingCalls.count).toBe(1)
    expect(filesWhenDebited).toBe(1)
    expect(cache.stats).toMatchObject({ hits: 0, misses: 1, usdPaid: 0.004 })
  })

  it('a hit returns the stored response with no gateway call, no wallet work and a 0-USD cached log row', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, () => chat())
    fetchMock.mockClear()
    logActivityCallMock.mockClear()
    billingCalls.count = 0
    chargeMock.mockClear()

    const again = await withEvalLlmCache(cache, () => chat())

    expect(again).toEqual(chatBody)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(billingCalls.count).toBe(0)
    expect(chargeMock).not.toHaveBeenCalled()
    expect(logActivityCallMock).toHaveBeenCalledTimes(1)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({
        operation: 'llm.chat.chat.cache_hit',
        baseCostUsd: 0,
        cached: true,
      }),
    )
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1, usdPaid: 0.004, usdAvoided: 0.004 })
  })

  it('a different prompt is a different call', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      await chat('one')
      await chat('two')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cache.stats.hits).toBe(0)
  })

  it('does not cache a response the wallet would refuse (no reported cost)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ choices: [] })),
    )
    const cache = createEvalLlmCache(dir)
    await expect(withEvalLlmCache(cache, () => chat())).rejects.toThrow(/missing usage.cost/)
    expect(existsSync(join(dir, MODEL_DIR))).toBe(false)
    expect(cache.stats.misses).toBe(0)
  })

  it('is off without a cache: always the gateway, always billed', async () => {
    const fetchMock = vi.fn(async () => ok(chatBody))
    vi.stubGlobal('fetch', fetchMock)
    await chat()
    await chat()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(billingCalls.count).toBe(2)
  })

  it('refuses a cache for a user that is not a harness billing user', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok(chatBody)),
    )
    await expect(
      withEvalLlmCache(createEvalLlmCache(dir), () =>
        llmChatCompletion({ userId: 'real-user', messages: [{ role: 'user', content: 'x' }] }),
      ),
    ).rejects.toThrow(/only allowed for harness billing users/)
  })
})

describe('llmCreateEmbeddings with the eval cache', () => {
  it('a hit costs nothing and keeps the vectors out of the log row', async () => {
    const fetchMock = vi.fn(async () => ok(embeddingBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, () => llmCreateEmbeddings({ userId: TENANT, input: 'hello' }))
    fetchMock.mockClear()
    logActivityCallMock.mockClear()
    billingCalls.count = 0

    const again = await withEvalLlmCache(cache, () =>
      llmCreateEmbeddings({ userId: TENANT, input: 'hello' }),
    )

    expect(again).toEqual(embeddingBody)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(billingCalls.count).toBe(0)
    expect(logActivityCallMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT,
      expect.objectContaining({
        operation: 'llm.embedding.cache_hit',
        baseCostUsd: 0,
        cached: true,
      }),
    )
    expect(JSON.stringify(logActivityCallMock.mock.calls)).not.toContain('0.1')
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 })
  })

  it('a different input is a different call', async () => {
    const fetchMock = vi.fn(async () => ok(embeddingBody))
    vi.stubGlobal('fetch', fetchMock)
    const cache = createEvalLlmCache(dir)
    await withEvalLlmCache(cache, async () => {
      await llmCreateEmbeddings({ userId: TENANT, input: 'a' })
      await llmCreateEmbeddings({ userId: TENANT, input: ['a', 'b'] })
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
